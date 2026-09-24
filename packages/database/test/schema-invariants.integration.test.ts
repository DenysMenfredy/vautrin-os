import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPlatformClient, type PrismaClient } from '../src/client.js';

/**
 * Schema invariants that no migration may quietly break.
 *
 * These guard things Prisma cannot express, and therefore cannot protect.
 * They run against a freshly migrated database in CI.
 */

let db: PrismaClient;

beforeAll(() => {
  db = createPlatformClient();
});

afterAll(async () => {
  await db.$disconnect();
});

describe('knowledge_chunks', () => {
  it('keeps its HNSW index', async () => {
    // Prisma has no syntax for an HNSW index, so the one created in
    // 20260919000400 is invisible to it and every generated migration adds
    // `DROP INDEX knowledge_chunks_embedding_hnsw_idx` as drift. Losing it
    // does not break any query — retrieval silently degrades to a
    // sequential scan over every chunk, which is exactly the kind of
    // regression that surfaces months later as "search got slow".
    const rows = await db.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'knowledge_chunks'
        AND indexname = 'knowledge_chunks_embedding_hnsw_idx'
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toContain('hnsw');
    expect(rows[0]?.indexdef).toContain('vector_cosine_ops');
  });

  it('still declares the embedding column as a vector', async () => {
    const rows = await db.$queryRaw<Array<{ type: string }>>`
      SELECT format_type(a.atttypid, a.atttypmod) AS type
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'knowledge_chunks'
        AND a.attname = 'embedding' AND NOT a.attisdropped
    `;

    expect(rows[0]?.type).toMatch(/^vector\(\d+\)$/);
  });
});

describe('global tables', () => {
  it.each(['users', 'refresh_tokens'])(
    '%s stays free of tenant_id (SDD-04 §3 "Global tables")',
    async (table) => {
      // If one of these ever gains a tenant_id, it needs an RLS policy and
      // the authentication path needs rethinking — both tables must be
      // readable before any tenant is known (ADR-013).
      const rows = await db.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${table}
          AND column_name = 'tenant_id'
      `;

      expect(rows).toHaveLength(0);
    },
  );
});

describe('published workflow versions', () => {
  it('pins the execution contract while allowing pause and new versions', async () => {
    const tenant = await db.tenant.create({
      data: { slug: `workflow-version-${crypto.randomUUID()}`, name: 'Workflow version test' },
    });
    try {
      const draft = await db.workflow.create({
        data: {
          tenantId: tenant.id,
          key: 'recovery',
          version: 1,
          name: 'Recovery',
          trigger: 'call.missed',
          definition: { steps: [] },
        },
      });
      expect(draft.publishedAt).toBeNull();
      const active = await db.workflow.update({
        where: { id: draft.id },
        data: { status: 'ACTIVE' },
      });
      expect(active.publishedAt).not.toBeNull();
      await expect(
        db.workflow.update({
          where: { id: draft.id },
          data: { definition: { steps: [{ id: 'changed', type: 'END' }] } },
        }),
      ).rejects.toThrow();
      const paused = await db.workflow.update({
        where: { id: draft.id },
        data: { status: 'PAUSED' },
      });
      expect(paused.definition).toEqual(active.definition);
      const next = await db.workflow.create({
        data: {
          tenantId: tenant.id,
          key: 'recovery',
          version: 2,
          name: 'Recovery',
          trigger: 'call.missed',
          definition: { steps: [{ id: 'changed', type: 'END' }] },
        },
      });
      expect(next.version).toBe(2);
    } finally {
      await db.tenant.delete({ where: { id: tenant.id } });
    }
  });
});
