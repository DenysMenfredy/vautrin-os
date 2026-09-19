/**
 * Errors raised by the data layer.
 *
 * These exist so callers can distinguish "the caller made a tenancy mistake"
 * from "the database is unhappy". The first is a bug worth failing loudly on;
 * the second is operational.
 */

/** A tenant identifier was absent or not a UUID. */
export class InvalidTenantContextError extends Error {
  override readonly name = 'InvalidTenantContextError';

  constructor(received: unknown) {
    super(
      `Expected a UUID tenant id, received ${JSON.stringify(received)}. ` +
        'Tenant context must be derived from authenticated membership, never from client input (SDD-05 §2).',
    );
  }
}

/**
 * A tenant-scoped query was attempted without tenant context.
 *
 * RLS would already return an empty result, but silently returning nothing is
 * indistinguishable from "no data" at the call site, which makes this class of
 * bug very hard to see. Failing loudly is the point.
 */
export class MissingTenantContextError extends Error {
  override readonly name = 'MissingTenantContextError';

  constructor(operation: string) {
    super(
      `"${operation}" touches tenant-scoped data but ran without tenant context. ` +
        'Wrap it in withTenant() (SDD-05 §3).',
    );
  }
}

/** The database schema does not match what this package expects. */
export class SchemaMismatchError extends Error {
  override readonly name = 'SchemaMismatchError';
}
