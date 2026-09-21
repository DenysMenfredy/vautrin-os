/**
 * Database package configuration.
 *
 * Values that differ per environment are read here and nowhere else, so the
 * rest of the package stays free of `process.env` lookups.
 */

/** Thrown when required configuration is missing or malformed. */
export class DatabaseConfigError extends Error {
  override readonly name = 'DatabaseConfigError';
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new DatabaseConfigError(`${name} must be a positive integer, received "${raw}".`);
  }
  return parsed;
}

/**
 * Embedding dimensions (SDD-04 §2).
 *
 * This is provider/model configuration, not a domain constant. It must match
 * the `vector(N)` column declared in the knowledge_chunks migration;
 * `assertEmbeddingDimensions` verifies that against the live database rather
 * than trusting the two to stay in step.
 */
export const EMBEDDING_DIMENSIONS = readInt('EMBEDDING_DIMENSIONS', 1536);

/** Session setting that carries the active tenant into PostgreSQL (SDD-05 §4). */
export const TENANT_SETTING = 'app.tenant_id';

/**
 * Session setting that carries the authenticated user.
 *
 * Used only by the authentication path, which must read a person's own
 * memberships before any tenant is known (SDD-05 §2).
 */
export const USER_SETTING = 'app.user_id';
