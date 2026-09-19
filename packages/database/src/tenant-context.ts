import type { Prisma, PrismaClient } from '../generated/client/index.js';

import { TENANT_SETTING } from './config.js';
import { InvalidTenantContextError } from './errors.js';

/**
 * A Prisma client already bound to one tenant's transaction.
 *
 * Structurally this is Prisma's transaction client; the distinct name is there
 * to make the tenancy requirement visible in repository signatures.
 */
export type TenantScopedClient = Prisma.TransactionClient;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Narrows an untrusted value to a tenant id.
 *
 * This is a format check, not an authorization check. The caller still has to
 * have derived the id from authenticated membership — SDD-05 §2: "A
 * client-provided arbitrary tenant ID is never sufficient authorization."
 */
export function assertTenantId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new InvalidTenantContextError(value);
  }
}

export interface WithTenantOptions {
  /** Max time to wait for a connection, ms. */
  readonly maxWait?: number;
  /** Max transaction duration, ms. */
  readonly timeout?: number;
  readonly isolationLevel?: Prisma.TransactionIsolationLevel;
}

/**
 * Runs `fn` with PostgreSQL tenant context set, inside one transaction.
 *
 * This is the only supported way to reach tenant-scoped data through the
 * runtime client, and the transaction is not incidental:
 *
 *   - `set_config(..., is_local => true)` scopes the setting to the
 *     transaction, so it is unset again when the transaction ends. A
 *     session-level SET would leak the tenant onto a pooled connection and
 *     hand it to whoever borrowed that connection next — the exact failure
 *     SDD-05 §4 warns about.
 *   - Every statement in `fn` therefore runs under the same tenant, and RLS
 *     evaluates `app.current_tenant_id()` consistently across all of them.
 *
 * The tenant id is passed as a bound parameter, never interpolated into SQL.
 *
 * @example
 * const leads = await withTenant(prisma, tenantId, (tx) =>
 *   tx.lead.findMany({ where: { status: 'NEW' } }),
 * );
 */
export async function withTenant<T>(
  client: PrismaClient,
  tenantId: string,
  fn: (tx: TenantScopedClient) => Promise<T>,
  options: WithTenantOptions = {},
): Promise<T> {
  assertTenantId(tenantId);

  // `async` + `return await` is deliberate: it keeps a failed assertTenantId
  // from throwing synchronously, so callers have exactly one error path
  // regardless of whether validation or the query failed.
  return await client.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config(${TENANT_SETTING}, ${tenantId}, true)`;
      return fn(tx);
    },
    {
      ...(options.maxWait !== undefined ? { maxWait: options.maxWait } : {}),
      ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
      ...(options.isolationLevel !== undefined ? { isolationLevel: options.isolationLevel } : {}),
    },
  );
}

/**
 * Reads back the tenant context PostgreSQL currently sees.
 *
 * Returns null when unset. Used by the isolation tests and by diagnostics;
 * application code should not need it.
 */
export async function currentTenantId(tx: TenantScopedClient): Promise<string | null> {
  const rows = await tx.$queryRaw<Array<{ tenant_id: string | null }>>`
    SELECT app.current_tenant_id()::text AS tenant_id
  `;
  return rows[0]?.tenant_id ?? null;
}

/**
 * Context that must accompany a background job (SDD-05 §5).
 *
 * A worker "must never infer tenant context from mutable global process
 * state", so every job payload carries this explicitly and reconstructs the
 * context on the other side.
 */
export interface TenantJobContext {
  readonly tenantId: string;
  /** Ties the job back to the request or event that caused it (SDD-10 §6). */
  readonly correlationId?: string;
  /** Who or what initiated the work. */
  readonly actorId?: string;
  readonly actorType?: 'USER' | 'AGENT' | 'SYSTEM' | 'INTEGRATION';
  /** Present for steps whose side effect must not repeat (SDD-07 §6). */
  readonly idempotencyKey?: string;
}

/** Validates a job payload's tenant context before it is used to open a transaction. */
export function assertTenantJobContext(context: unknown): asserts context is TenantJobContext {
  if (typeof context !== 'object' || context === null) {
    throw new InvalidTenantContextError(context);
  }
  assertTenantId((context as { tenantId?: unknown }).tenantId);
}
