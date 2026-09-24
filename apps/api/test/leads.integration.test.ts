import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createPlatformClient, type PrismaClient } from '@vautrin/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';
import { TenantService } from '../src/tenant/tenant.service.js';

let app: INestApplication;
let baseUrl: string;
let platform: PrismaClient;
let tenantA = '';
let tenantB = '';
let ownerToken = '';
let otherOwnerToken = '';
let managerToken = '';
let staffToken = '';
let readOnlyToken = '';
let staffUserId = '';
let readOnlyUserId = '';
let otherOwnerId = '';
let contactA = '';
let contactB = '';
let sourceA = '';
let sourceB = '';
let leadId = '';
let secondLeadId = '';

const suffix = Date.now();
const owner = {
  email: `leads-owner-${suffix}@example.test`,
  password: 'a long lead owner password',
};
const otherOwner = {
  email: `leads-other-${suffix}@example.test`,
  password: 'a different long lead owner password',
};
const manager = {
  email: `leads-manager-${suffix}@example.test`,
  password: 'a long lead manager password',
};
const staff = {
  email: `leads-staff-${suffix}@example.test`,
  password: 'a long lead staff password',
};
const readOnly = {
  email: `leads-reader-${suffix}@example.test`,
  password: 'a long lead reader password',
};

function request(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  token: string,
  body?: unknown,
) {
  return fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function login(credentials: { email: string; password: string }): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { accessToken: string }).accessToken;
}

async function createdId(response: Response): Promise<string> {
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AllExceptionsFilter());
  const { ValidationPipe } = await import('@nestjs/common');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.listen(0);
  baseUrl = await app.getUrl();

  platform = createPlatformClient();
  const tenants = app.get(TenantService);
  const first = await tenants.provision({
    slug: `leads-a-${suffix}`,
    name: 'Lead Tenant A',
    owner: { ...owner, name: 'Lead Owner' },
  });
  tenantA = first.tenantId;
  const second = await tenants.provision({
    slug: `leads-b-${suffix}`,
    name: 'Lead Tenant B',
    owner: otherOwner,
  });
  tenantB = second.tenantId;
  otherOwnerId = second.userId;
  await tenants.addMember({
    tenantId: tenantA,
    email: manager.email,
    password: manager.password,
    role: 'MANAGER',
  });
  staffUserId = (
    await tenants.addMember({
      tenantId: tenantA,
      email: staff.email,
      password: staff.password,
      role: 'STAFF',
    })
  ).userId;
  readOnlyUserId = (
    await tenants.addMember({
      tenantId: tenantA,
      email: readOnly.email,
      password: readOnly.password,
      role: 'READ_ONLY',
    })
  ).userId;

  [ownerToken, otherOwnerToken, managerToken, staffToken, readOnlyToken] = await Promise.all([
    login(owner),
    login(otherOwner),
    login(manager),
    login(staff),
    login(readOnly),
  ]);

  contactA = await createdId(
    await request('POST', '/contacts', ownerToken, { firstName: 'Tenant A Customer' }),
  );
  contactB = await createdId(
    await request('POST', '/contacts', otherOwnerToken, { firstName: 'Tenant B Customer' }),
  );
  await createdId(
    await request('POST', '/business/services', ownerToken, {
      key: 'kitchen-remodel',
      name: 'Kitchen Remodel',
    }),
  );
  sourceA = await createdId(
    await request('POST', '/lead-sources', ownerToken, {
      key: 'website',
      label: 'Website',
      category: 'inbound',
    }),
  );
  sourceB = await createdId(
    await request('POST', '/lead-sources', otherOwnerToken, {
      key: 'referral',
      label: 'Referral',
    }),
  );
});

afterAll(async () => {
  await platform?.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await platform?.user.deleteMany({
    where: {
      email: { in: [owner.email, otherOwner.email, manager.email, staff.email, readOnly.email] },
    },
  });
  await platform?.$disconnect();
  await app?.close();
});

describe('CRM Gate D (VOS-051–055)', () => {
  it('manages a tenant lead-source catalog without granting staff configuration rights', async () => {
    expect((await request('GET', `/lead-sources/${sourceA}`, ownerToken)).status).toBe(200);
    expect((await request('GET', `/lead-sources/${sourceA}`, otherOwnerToken)).status).toBe(404);
    expect((await request('GET', '/lead-sources?active=true', readOnlyToken)).status).toBe(200);
    expect(
      (await request('POST', '/lead-sources', staffToken, { key: 'phone', label: 'Phone' })).status,
    ).toBe(403);
    expect(
      (await request('POST', '/lead-sources', ownerToken, { key: 'website', label: 'Duplicate' }))
        .status,
    ).toBe(409);
  });

  it('creates leads with validated tenant references, outbox events, audit, and pipeline counts', async () => {
    const response = await request('POST', '/leads', ownerToken, {
      contactId: contactA,
      sourceId: sourceA,
      service: 'kitchen-remodel',
      title: 'Kitchen consultation',
      description: 'Remodel the kitchen',
      estimatedValue: '12500.50',
    });
    expect(response.status).toBe(201);
    const lead = (await response.json()) as {
      id: string;
      status: string;
      version: number;
      estimatedValue: string;
    };
    leadId = lead.id;
    expect(lead).toMatchObject({ status: 'NEW', version: 0, estimatedValue: '12500.50' });
    expect(lead).not.toHaveProperty('tenantId');
    expect((await request('GET', `/leads/${leadId}`, ownerToken)).status).toBe(200);

    secondLeadId = await createdId(
      await request('POST', '/leads', staffToken, {
        contactId: contactA,
        title: 'Bathroom consultation',
      }),
    );
    const searched = await request('GET', '/leads?status=NEW&search=KITCHEN', ownerToken);
    expect(await searched.json()).toMatchObject({ items: [{ id: leadId }], nextCursor: null });
    const pageResponse = await request('GET', '/leads?limit=1', ownerToken);
    const page = (await pageResponse.json()) as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const nextPage = await request(
      'GET',
      `/leads?limit=1&cursor=${encodeURIComponent(page.nextCursor ?? '')}`,
      ownerToken,
    );
    const nextItems = (await nextPage.json()) as { items: Array<{ id: string }> };
    expect(new Set([page.items[0]?.id, nextItems.items[0]?.id])).toEqual(
      new Set([leadId, secondLeadId]),
    );
    expect(
      await request('GET', '/crm/dashboard', ownerToken).then((result) => result.json()),
    ).toMatchObject({
      total: 2,
      byStatus: { NEW: 2, LOST: 0 },
    });
    expect((await request('GET', '/crm/dashboard', otherOwnerToken)).status).toBe(200);
    expect(
      await platform.event.count({
        where: { tenantId: tenantA, aggregateId: leadId, name: 'lead.created' },
      }),
    ).toBe(1);
    expect(
      await platform.auditLog.count({
        where: { tenantId: tenantA, resourceId: leadId, action: 'lead.created' },
      }),
    ).toBe(1);
  });

  it('rejects cross-tenant references and access, including client tenant IDs', async () => {
    expect((await request('GET', `/leads/${leadId}`, otherOwnerToken)).status).toBe(404);
    expect(
      (await request('PATCH', `/leads/${leadId}`, otherOwnerToken, { version: 0, title: 'Hijack' }))
        .status,
    ).toBe(404);
    expect((await request('DELETE', `/leads/${leadId}`, otherOwnerToken)).status).toBe(404);
    expect((await request('POST', '/leads', otherOwnerToken, { contactId: contactA })).status).toBe(
      404,
    );
    expect((await request('POST', '/leads', ownerToken, { contactId: contactB })).status).toBe(404);
    expect(
      (await request('POST', '/leads', ownerToken, { contactId: contactA, sourceId: sourceB }))
        .status,
    ).toBe(404);
    expect(
      (await request('POST', '/leads', ownerToken, { contactId: contactA, tenantId: tenantB }))
        .status,
    ).toBe(400);
    expect(
      await request('GET', '/leads', otherOwnerToken).then((result) => result.json()),
    ).toMatchObject({ items: [] });
  });

  it('enforces versioned updates, assignment and forward-only terminal transitions', async () => {
    const updated = await request('PATCH', `/leads/${leadId}`, ownerToken, {
      version: 0,
      title: 'Kitchen remodel estimate',
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ version: 1 });
    expect(
      (await request('PATCH', `/leads/${leadId}`, ownerToken, { version: 0, title: 'Stale' }))
        .status,
    ).toBe(409);

    expect(
      (
        await request('PATCH', `/leads/${leadId}/assignment`, staffToken, {
          version: 1,
          assignedUserId: staffUserId,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request('PATCH', `/leads/${leadId}/assignment`, managerToken, {
          version: 1,
          assignedUserId: otherOwnerId,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request('PATCH', `/leads/${leadId}/assignment`, managerToken, {
          version: 1,
          assignedUserId: readOnlyUserId,
        })
      ).status,
    ).toBe(404);
    const assigned = await request('PATCH', `/leads/${leadId}/assignment`, managerToken, {
      version: 1,
      assignedUserId: staffUserId,
    });
    expect(await assigned.json()).toMatchObject({ assignedUserId: staffUserId, version: 2 });
    const unassigned = await request('PATCH', `/leads/${leadId}/assignment`, managerToken, {
      version: 2,
      assignedUserId: null,
    });
    expect(await unassigned.json()).toMatchObject({ assignedUserId: null, version: 3 });

    const qualified = await request('PATCH', `/leads/${leadId}/status`, staffToken, {
      version: 3,
      status: 'QUALIFIED',
    });
    expect(await qualified.json()).toMatchObject({ status: 'QUALIFIED', version: 4 });
    expect(
      (
        await request('PATCH', `/leads/${leadId}/status`, ownerToken, {
          version: 4,
          status: 'CONTACTED',
        })
      ).status,
    ).toBe(400);
    const lost = await request('PATCH', `/leads/${leadId}/status`, ownerToken, {
      version: 4,
      status: 'LOST',
    });
    expect(await lost.json()).toMatchObject({ status: 'LOST', version: 5 });
    expect(
      (await request('PATCH', `/leads/${leadId}/status`, ownerToken, { version: 5, status: 'WON' }))
        .status,
    ).toBe(400);
    expect(
      await request('GET', '/crm/dashboard', ownerToken).then((result) => result.json()),
    ).toMatchObject({
      total: 2,
      byStatus: { NEW: 1, LOST: 1 },
    });

    expect((await request('DELETE', `/lead-sources/${sourceA}`, ownerToken)).status).toBe(204);
    expect(
      (await request('POST', '/leads', ownerToken, { contactId: contactA, sourceId: sourceA }))
        .status,
    ).toBe(404);
    expect((await request('DELETE', `/leads/${leadId}`, ownerToken)).status).toBe(204);
    expect((await request('GET', `/leads/${leadId}`, ownerToken)).status).toBe(404);
    expect(
      await request('GET', '/crm/dashboard', ownerToken).then((result) => result.json()),
    ).toMatchObject({
      total: 1,
      byStatus: { NEW: 1, LOST: 0 },
    });
    expect(
      await platform.lead.findFirst({
        where: { id: leadId, tenantId: tenantA },
        select: { deletedAt: true },
      }),
    ).toMatchObject({ deletedAt: expect.any(Date) });
    const actions = await platform.auditLog.findMany({
      where: { tenantId: tenantA, resourceId: leadId, resourceType: 'lead' },
      select: { action: true },
    });
    expect(actions.map(({ action }) => action)).toEqual(
      expect.arrayContaining([
        'lead.created',
        'lead.updated',
        'lead.assigned',
        'lead.status_changed',
        'lead.archived',
      ]),
    );
    expect(
      await platform.event.count({
        where: { tenantId: tenantA, aggregateId: leadId, name: 'lead.status_changed' },
      }),
    ).toBe(2);
  });
});
