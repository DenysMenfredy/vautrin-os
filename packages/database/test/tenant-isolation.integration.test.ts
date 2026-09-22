import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  assertEmbeddingDimensions,
  createPlatformClient,
  createPrismaClient,
  type PrismaClient,
} from '../src/client.js';
import { EMBEDDING_DIMENSIONS } from '../src/config.js';
import { currentTenantId, withTenant, withUser } from '../src/tenant-context.js';
import { searchKnowledgeChunks, upsertKnowledgeChunk } from '../src/vector.js';

/**
 * Tenant isolation tests (SDD-05 §6, SDD-11 §4).
 *
 * These are the tests ADR-005 exists for. They run as `vautrin_app` — the
 * runtime role, which is neither the table owner nor BYPASSRLS — because RLS
 * enforcement is invisible if the tests connect as a privileged role.
 *
 * `platform` (the schema-owning role) is used only to seed and tear down.
 */

let platform: PrismaClient;
let app: PrismaClient;

const seed = {
  a: { id: '', slug: `iso-a-${Date.now()}` },
  b: { id: '', slug: `iso-b-${Date.now()}` },
};

/** Distinct but deterministic embedding, so similarity ordering is stable. */
function embedding(seedValue: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => Math.sin((i + 1) * seedValue) / 10);
}

interface TenantFixture {
  tenantId: string;
  contactId: string;
  leadId: string;
  conversationId: string;
  workflowId: string;
  workflowRunId: string;
  documentId: string;
  serviceId: string;
  serviceAreaId: string;
}

async function seedTenant(slug: string, label: string): Promise<TenantFixture> {
  const tenant = await platform.tenant.create({
    data: { slug, name: `${label} Remodeling`, vertical: 'remodeling' },
  });

  const contact = await platform.contact.create({
    data: {
      tenantId: tenant.id,
      firstName: label,
      lastName: 'Customer',
      phone: `+1555000${label === 'A' ? '1111' : '2222'}`,
      email: `${label.toLowerCase()}@example.test`,
    },
  });

  const lead = await platform.lead.create({
    data: {
      tenantId: tenant.id,
      contactId: contact.id,
      status: 'NEW',
      title: `${label} kitchen remodel`,
    },
  });

  const conversation = await platform.conversation.create({
    data: {
      tenantId: tenant.id,
      contactId: contact.id,
      leadId: lead.id,
      channel: 'SMS',
    },
  });

  await platform.message.create({
    data: {
      tenantId: tenant.id,
      conversationId: conversation.id,
      direction: 'INBOUND',
      channel: 'SMS',
      body: `${label} secret message body`,
    },
  });

  const workflow = await platform.workflow.create({
    data: {
      tenantId: tenant.id,
      key: 'missed-call-recovery',
      name: 'Missed call recovery',
      trigger: 'call.missed',
      status: 'ACTIVE',
      version: 1,
    },
  });

  const workflowRun = await platform.workflowRun.create({
    data: {
      tenantId: tenant.id,
      workflowId: workflow.id,
      workflowVersion: 1,
      triggerEvent: 'call.missed',
      status: 'PENDING',
    },
  });

  const document = await platform.knowledgeDocument.create({
    data: {
      tenantId: tenant.id,
      title: `${label} pricing guide`,
      sourceType: 'manual',
      status: 'READY',
    },
  });

  const service = await platform.service.create({
    data: {
      tenantId: tenant.id,
      key: `kitchen-${label.toLowerCase()}`,
      name: `${label} Kitchen Remodeling`,
      active: true,
    },
  });

  const serviceArea = await platform.serviceArea.create({
    data: {
      tenantId: tenant.id,
      type: 'POSTAL_CODE',
      value: label === 'A' ? '10001' : '20001',
      active: true,
    },
  });

  await withTenant(platform, tenant.id, (tx) =>
    upsertKnowledgeChunk(tx, {
      tenantId: tenant.id,
      documentId: document.id,
      chunkIndex: 0,
      content: `${label} charges a flat 15% design fee.`,
      embedding: embedding(label === 'A' ? 1 : 2),
    }),
  );

  return {
    tenantId: tenant.id,
    contactId: contact.id,
    leadId: lead.id,
    conversationId: conversation.id,
    workflowId: workflow.id,
    workflowRunId: workflowRun.id,
    documentId: document.id,
    serviceId: service.id,
    serviceAreaId: serviceArea.id,
  };
}

let tenantA: TenantFixture;
let tenantB: TenantFixture;

beforeAll(async () => {
  platform = createPlatformClient();
  app = createPrismaClient();

  await assertEmbeddingDimensions(platform);

  tenantA = await seedTenant(seed.a.slug, 'A');
  tenantB = await seedTenant(seed.b.slug, 'B');
});

afterAll(async () => {
  // Cascades through every tenant-scoped table.
  await platform.tenant.deleteMany({
    where: { id: { in: [tenantA?.tenantId, tenantB?.tenantId].filter(Boolean) as string[] } },
  });
  await platform.$disconnect();
  await app.$disconnect();
});

describe('runtime role', () => {
  it('is not a superuser and cannot bypass RLS', async () => {
    const rows = await app.$queryRaw<
      Array<{ rolsuper: boolean; rolbypassrls: boolean; current_role: string }>
    >`
      SELECT r.rolsuper, r.rolbypassrls, current_user AS current_role
      FROM pg_roles r WHERE r.rolname = current_user
    `;

    // If this ever fails, every other test in this file is meaningless.
    expect(rows[0]?.rolsuper).toBe(false);
    expect(rows[0]?.rolbypassrls).toBe(false);
  });
});

describe('tenant context', () => {
  it('is set inside withTenant and scoped to the transaction', async () => {
    const inside = await withTenant(app, tenantA.tenantId, (tx) => currentTenantId(tx));
    expect(inside).toBe(tenantA.tenantId);

    // A fresh transaction must not inherit the previous tenant. This is the
    // pooled-connection leak SDD-05 §4 warns about.
    const after = await app.$transaction((tx) => currentTenantId(tx));
    expect(after).toBeNull();
  });

  it('rejects a non-UUID tenant id before touching the database', async () => {
    await expect(withTenant(app, "' OR 1=1 --", async () => 'unreachable')).rejects.toThrow(
      /Expected a UUID tenant id/,
    );
  });
});

describe('SELECT isolation (SDD-05 §6)', () => {
  it('returns only the active tenant rows', async () => {
    const leads = await withTenant(app, tenantA.tenantId, (tx) => tx.lead.findMany());
    expect(leads).toHaveLength(1);
    expect(leads[0]?.id).toBe(tenantA.leadId);
  });

  it('cannot read another tenant row even by primary key', async () => {
    const found = await withTenant(app, tenantA.tenantId, (tx) =>
      tx.lead.findUnique({ where: { id: tenantB.leadId } }),
    );
    expect(found).toBeNull();
  });

  it('returns nothing at all without tenant context', async () => {
    // Fail closed: no context means no rows, never all rows.
    const leads = await app.lead.findMany();
    expect(leads).toHaveLength(0);

    const contacts = await app.contact.findMany();
    expect(contacts).toHaveLength(0);

    expect(await app.service.findMany()).toHaveLength(0);
    expect(await app.serviceArea.findMany()).toHaveLength(0);
  });
});

describe('INSERT isolation (SDD-05 §6)', () => {
  it('refuses to write a row stamped with another tenant', async () => {
    // This is what WITH CHECK buys us. Without it, tenant A could forge rows
    // into tenant B by simply setting tenant_id.
    await expect(
      withTenant(app, tenantA.tenantId, (tx) =>
        tx.contact.create({
          data: { tenantId: tenantB.tenantId, firstName: 'Forged', lastName: 'Row' },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('allows a write for the active tenant', async () => {
    const created = await withTenant(app, tenantA.tenantId, (tx) =>
      tx.contact.create({
        data: { tenantId: tenantA.tenantId, firstName: 'Legit', lastName: 'Row' },
      }),
    );
    expect(created.tenantId).toBe(tenantA.tenantId);

    await platform.contact.delete({ where: { id: created.id } });
  });
});

describe('UPDATE isolation (SDD-05 §6)', () => {
  it('cannot update another tenant row', async () => {
    const result = await withTenant(app, tenantA.tenantId, (tx) =>
      tx.lead.updateMany({
        where: { id: tenantB.leadId },
        data: { status: 'LOST' },
      }),
    );
    expect(result.count).toBe(0);

    const untouched = await platform.lead.findUniqueOrThrow({
      where: { id: tenantB.leadId },
    });
    expect(untouched.status).toBe('NEW');
  });
});

describe('DELETE isolation (SDD-05 §6)', () => {
  it('cannot delete another tenant row', async () => {
    const result = await withTenant(app, tenantA.tenantId, (tx) =>
      tx.contact.deleteMany({ where: { id: tenantB.contactId } }),
    );
    expect(result.count).toBe(0);

    const stillThere = await platform.contact.findUnique({
      where: { id: tenantB.contactId },
    });
    expect(stillThere).not.toBeNull();
  });
});

describe('conversation isolation (SDD-05 §6)', () => {
  it('does not leak messages across tenants', async () => {
    const messages = await withTenant(app, tenantA.tenantId, (tx) => tx.message.findMany());
    expect(messages).toHaveLength(1);
    expect(messages[0]?.body).toContain('A secret');

    const conversations = await withTenant(app, tenantA.tenantId, (tx) =>
      tx.conversation.findMany(),
    );
    expect(conversations.map((c) => c.id)).toEqual([tenantA.conversationId]);
  });
});

describe('workflow isolation (SDD-05 §6)', () => {
  it('scopes workflows and runs to the active tenant', async () => {
    const runs = await withTenant(app, tenantB.tenantId, (tx) => tx.workflowRun.findMany());
    expect(runs.map((r) => r.id)).toEqual([tenantB.workflowRunId]);

    const workflows = await withTenant(app, tenantB.tenantId, (tx) => tx.workflow.findMany());
    expect(workflows.map((w) => w.id)).toEqual([tenantB.workflowId]);
  });
});

describe('knowledge and vector isolation (SDD-05 §6)', () => {
  it('restricts semantic search to the active tenant', async () => {
    // Search tenant A using the embedding that best matches tenant B's chunk.
    // A similarity-ranked query is exactly where a missing tenant filter would
    // quietly surface another business's content.
    const results = await withTenant(app, tenantA.tenantId, (tx) =>
      searchKnowledgeChunks(tx, {
        tenantId: tenantA.tenantId,
        embedding: embedding(2),
        limit: 10,
      }),
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.content).toContain('A charges');
    expect(results.some((r) => r.content.includes('B charges'))).toBe(false);
  });

  it('cannot read another tenant chunk rows directly', async () => {
    const chunks = await withTenant(app, tenantB.tenantId, (tx) => tx.knowledgeChunk.findMany());
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.tenantId).toBe(tenantB.tenantId);
  });

  it('refuses to embed a chunk into another tenant document', async () => {
    await expect(
      withTenant(app, tenantA.tenantId, (tx) =>
        upsertKnowledgeChunk(tx, {
          tenantId: tenantB.tenantId,
          documentId: tenantB.documentId,
          chunkIndex: 99,
          content: 'cross-tenant write attempt',
          embedding: embedding(3),
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('business configuration isolation (ADR-014)', () => {
  it('scopes services and service areas to the active tenant', async () => {
    const services = await withTenant(app, tenantA.tenantId, (tx) => tx.service.findMany());
    expect(services.map((service) => service.id)).toEqual([tenantA.serviceId]);

    const areas = await withTenant(app, tenantA.tenantId, (tx) => tx.serviceArea.findMany());
    expect(areas.map((area) => area.id)).toEqual([tenantA.serviceAreaId]);

    const hiddenService = await withTenant(app, tenantA.tenantId, (tx) =>
      tx.service.findUnique({ where: { id: tenantB.serviceId } }),
    );
    expect(hiddenService).toBeNull();
  });

  it('rejects forged cross-tenant service configuration', async () => {
    await expect(
      withTenant(app, tenantA.tenantId, (tx) =>
        tx.service.create({
          data: {
            tenantId: tenantB.tenantId,
            key: 'forged',
            name: 'Forged service',
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);

    await expect(
      withTenant(app, tenantA.tenantId, (tx) =>
        tx.serviceArea.create({
          data: {
            tenantId: tenantB.tenantId,
            type: 'CITY',
            value: 'Forged city',
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('background job context (SDD-05 §5)', () => {
  it('reconstructs isolation from a job payload alone', async () => {
    // A worker receives only this payload — no ambient request state.
    const jobPayload = { tenantId: tenantB.tenantId, correlationId: crypto.randomUUID() };

    const leads = await withTenant(app, jobPayload.tenantId, (tx) => tx.lead.findMany());

    expect(leads).toHaveLength(1);
    expect(leads[0]?.id).toBe(tenantB.leadId);
  });
});

describe('user context (migration 20260919000600)', () => {
  /**
   * `app.user_id` unlocks two SELECT policies so authentication can read a
   * person's own memberships before a tenant exists (SDD-05 §2). These
   * tests exist because that is a deliberate hole in tenant isolation, and
   * a hole is only acceptable while it stays exactly the size intended.
   */
  let userA = '';
  let userB = '';

  beforeAll(async () => {
    const a = await platform.user.create({
      data: { email: `ctx-a-${Date.now()}@example.test`, status: 'ACTIVE' },
    });
    const b = await platform.user.create({
      data: { email: `ctx-b-${Date.now()}@example.test`, status: 'ACTIVE' },
    });
    userA = a.id;
    userB = b.id;

    await platform.tenantUser.create({
      data: { tenantId: tenantA.tenantId, userId: userA, role: 'OWNER' },
    });
    await platform.tenantUser.create({
      data: { tenantId: tenantB.tenantId, userId: userB, role: 'OWNER' },
    });
  });

  afterAll(async () => {
    await platform.user.deleteMany({ where: { id: { in: [userA, userB] } } });
  });

  it('shows a user their own memberships', async () => {
    const rows = await withUser(app, userA, (tx) => tx.tenantUser.findMany());

    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(userA);
    expect(rows[0]?.tenantId).toBe(tenantA.tenantId);
  });

  it("does not show one user another user's memberships", async () => {
    // The whole point: user context must expose YOUR rows, not everyone's.
    const rows = await withUser(app, userA, (tx) => tx.tenantUser.findMany());

    expect(rows.some((row) => row.userId === userB)).toBe(false);
  });

  it('shows only the tenants the user actually belongs to', async () => {
    const rows = await withUser(app, userA, (tx) => tx.tenant.findMany());

    expect(rows.map((row) => row.id)).toEqual([tenantA.tenantId]);
  });

  it('grants nothing on other tenant-scoped tables', async () => {
    // User context must not become a general-purpose bypass: leads,
    // contacts and the rest still require tenant context.
    const [leads, contacts, messages] = await withUser(app, userA, async (tx) => [
      await tx.lead.findMany(),
      await tx.contact.findMany(),
      await tx.message.findMany(),
    ]);

    expect(leads).toHaveLength(0);
    expect(contacts).toHaveLength(0);
    expect(messages).toHaveLength(0);
  });

  it('is SELECT-only: a user cannot grant themselves a membership', async () => {
    // If this ever succeeds, anyone who can authenticate can join any
    // tenant. The policy is deliberately FOR SELECT.
    await expect(
      withUser(app, userA, (tx) =>
        tx.tenantUser.create({
          data: { tenantId: tenantB.tenantId, userId: userA, role: 'OWNER' },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('grants nothing at all when no user context is set', async () => {
    const rows = await app.tenantUser.findMany();
    expect(rows).toHaveLength(0);
  });
});
