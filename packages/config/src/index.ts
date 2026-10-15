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

  /** Exact browser origins allowed to send cookie-authenticated mutations. */
  TRUSTED_ORIGINS: z.string().default(''),

  /** Number of trusted proxy hops in front of the API. */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /**
   * Signing key for access tokens (ADR-013).
   *
   * No default: a fallback secret is worse than a missing one, because the
   * application boots and silently signs tokens anyone can forge. 32 bytes
   * minimum so HS256 is keyed with at least as much entropy as its output.
   * Generate with `openssl rand -base64 48`.
   */
  JWT_SECRET: z
    .string()
    .min(32, 'must be at least 32 characters; generate with `openssl rand -base64 48`'),
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

  if (environment.NODE_ENV === 'production' && environment.JWT_SECRET === DEV_JWT_SECRET) {
    throw new ConfigurationError(
      'JWT_SECRET is still the development value from .env.example. Access tokens ' +
        'signed with a published key can be forged by anyone. Generate one with ' +
        '`openssl rand -base64 48`.',
    );
  }

  const trustedOrigins = environment.TRUSTED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (environment.NODE_ENV === 'production' && trustedOrigins.length === 0) {
    throw new ConfigurationError(
      'TRUSTED_ORIGINS must contain at least one exact frontend origin in production.',
    );
  }
  for (const origin of trustedOrigins) {
    try {
      const parsed = new URL(origin);
      if (parsed.origin !== origin || parsed.pathname !== '/' || parsed.search || parsed.hash) {
        throw new Error('not an exact origin');
      }
    } catch {
      throw new ConfigurationError(`TRUSTED_ORIGINS contains an invalid exact origin: ${origin}`);
    }
  }

  return environment;
}

/**
 * The value shipped in .env.example.
 *
 * Kept here so production can refuse it. It is not a secret — that is the
 * entire point: it is published, so it must never sign a real token.
 */
export const DEV_JWT_SECRET = 'dev-only-insecure-jwt-secret-do-not-use-in-production-0000';

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
export { redisTlsOptions } from './redis-tls.js';
