/**
 * @vautrin/config — validated environment configuration.
 *
 * Both apps/api and apps/worker need the same connection strings and runtime
 * settings. Parsing them in one place means a missing or malformed variable
 * fails identically in both, at boot, with the same message.
 *
 * SDD-09 §7: secrets arrive through the environment or a secret manager and
 * are never committed. This module reads them; it never logs them.
 */

import { z } from 'zod';

/** Thrown when the environment is missing or malformed. */
export class ConfigurationError extends Error {
  override readonly name = 'ConfigurationError';
}

const postgresUrl = z
  .string()
  .min(1)
  .refine(
    (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
    'must be a postgresql:// connection string',
  );

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /**
   * Runtime database connection. This must be the least-privileged role, the
   * one that RLS actually constrains (ADR-005). Pointing it at the migration
   * role would silently disable tenant isolation for the whole application,
   * so the check below is a guard rail rather than a style preference.
   */
  DATABASE_URL: postgresUrl,

  /** Schema-owning role. Used by migrations and tenant provisioning only. */
  DATABASE_MIGRATION_URL: postgresUrl.optional(),

  /** Queue backend (ADR-009). */
  REDIS_URL: z
    .string()
    .min(1)
    .refine(
      (value) => value.startsWith('redis://') || value.startsWith('rediss://'),
      'must be a redis:// connection string',
    ),

  API_PORT: z.coerce.number().int().positive().max(65535).default(3000),
  API_GLOBAL_PREFIX: z.string().default('api'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Environment = z.infer<typeof environmentSchema>;

/**
 * Parses and validates the environment.
 *
 * Reports every problem at once rather than one per restart, and never
 * includes the offending value in the message — these are connection strings
 * with passwords in them (SDD-09 §8).
 */
export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const result = environmentSchema.safeParse(source);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new ConfigurationError(`Invalid environment configuration:\n${problems}`);
  }

  const environment = result.data;

  if (environment.NODE_ENV === 'production' && environment.DATABASE_MIGRATION_URL) {
    const runtimeRole = roleOf(environment.DATABASE_URL);
    const migrationRole = roleOf(environment.DATABASE_MIGRATION_URL);

    if (runtimeRole !== undefined && runtimeRole === migrationRole) {
      throw new ConfigurationError(
        'DATABASE_URL and DATABASE_MIGRATION_URL use the same role. The runtime role ' +
          'must not own the schema, or PostgreSQL row level security will not apply to it (ADR-005).',
      );
    }
  }

  return environment;
}

/** Extracts the username from a connection string without exposing the password. */
function roleOf(connectionString: string): string | undefined {
  try {
    return new URL(connectionString).username || undefined;
  } catch {
    return undefined;
  }
}

export const isProduction = (environment: Environment): boolean =>
  environment.NODE_ENV === 'production';
