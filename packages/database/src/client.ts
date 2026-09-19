import { PrismaClient } from '../generated/client/index.js';

import { EMBEDDING_DIMENSIONS } from './config.js';
import { SchemaMismatchError } from './errors.js';

export type { PrismaClient } from '../generated/client/index.js';
export { Prisma } from '../generated/client/index.js';

export interface CreateClientOptions {
  /** Overrides DATABASE_URL. Mainly for tests that need a specific role. */
  readonly url?: string;
  /** Prisma log levels. Query logging is off by default: it is noisy and can echo customer data (SDD-09 §8). */
  readonly log?: ReadonlyArray<'query' | 'info' | 'warn' | 'error'>;
}

/**
 * Creates a Prisma client for the **runtime** role.
 *
 * This connects as `vautrin_app`, which is subject to RLS. Every tenant-scoped
 * query made through it must go through `withTenant`, or PostgreSQL will
 * return nothing (see errors.ts for why that is deliberate).
 */
export function createPrismaClient(options: CreateClientOptions = {}): PrismaClient {
  const url = options.url ?? process.env.DATABASE_URL;
  if (!url) {
    throw new SchemaMismatchError('DATABASE_URL is not set.');
  }

  return new PrismaClient({
    datasources: { db: { url } },
    log: [...(options.log ?? ['warn', 'error'])],
  });
}

/**
 * Creates a client for the **privileged** role that owns the schema.
 *
 * Needed for the few operations that sit outside any single tenant:
 * provisioning a tenant, the tenant-deletion lifecycle (SDD-05 §8), and
 * platform maintenance. It bypasses RLS, so it must never be handed to
 * request-scoped application code.
 */
export function createPlatformClient(options: CreateClientOptions = {}): PrismaClient {
  const url = options.url ?? process.env.DATABASE_MIGRATION_URL;
  if (!url) {
    throw new SchemaMismatchError('DATABASE_MIGRATION_URL is not set.');
  }

  return new PrismaClient({
    datasources: { db: { url } },
    log: [...(options.log ?? ['warn', 'error'])],
  });
}

/**
 * Verifies the `knowledge_chunks.embedding` column matches EMBEDDING_DIMENSIONS.
 *
 * SDD-04 §2 keeps the dimension as provider configuration, which means the
 * application constant and the database column can drift apart. A mismatch
 * would otherwise surface as a confusing insert error deep inside the
 * embedding pipeline, so applications call this at startup instead.
 */
export async function assertEmbeddingDimensions(client: PrismaClient): Promise<void> {
  const rows = await client.$queryRaw<Array<{ dimensions: number | null }>>`
    SELECT a.atttypmod AS dimensions
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'knowledge_chunks'
      AND a.attname = 'embedding'
      AND NOT a.attisdropped
  `;

  const actual = rows[0]?.dimensions;
  if (actual === undefined || actual === null) {
    throw new SchemaMismatchError(
      'knowledge_chunks.embedding is missing. Run `pnpm db:deploy` before starting the application.',
    );
  }

  if (actual !== EMBEDDING_DIMENSIONS) {
    throw new SchemaMismatchError(
      `EMBEDDING_DIMENSIONS is ${EMBEDDING_DIMENSIONS} but knowledge_chunks.embedding is vector(${actual}). ` +
        'Changing embedding dimensions requires a migration and re-embedding every chunk.',
    );
  }
}
