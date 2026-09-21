import { describe, expect, it } from 'vitest';

import { ConfigurationError, DEV_JWT_SECRET, loadEnvironment } from '../src/index.js';

const valid = {
  DATABASE_URL: 'postgresql://vautrin_app:pw@localhost:5435/vautrin',
  DATABASE_MIGRATION_URL: 'postgresql://vautrin_migrator:pw@localhost:5435/vautrin',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(48),
};

describe('loadEnvironment', () => {
  it('applies defaults', () => {
    const env = loadEnvironment(valid);
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(3000);
    expect(env.API_GLOBAL_PREFIX).toBe('api');
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('coerces API_PORT from a string', () => {
    expect(loadEnvironment({ ...valid, API_PORT: '8080' }).API_PORT).toBe(8080);
  });

  it('reports every problem at once', () => {
    try {
      loadEnvironment({ DATABASE_URL: 'mysql://x', REDIS_URL: 'http://x' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      const message = (error as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('REDIS_URL');
    }
  });

  it('never echoes the connection string back in the error', () => {
    // Connection strings carry passwords; the message must stay safe to log.
    try {
      // The marker must sit on the same line as the match. Synthetic value:
      // this test asserts the password is NOT echoed back, so it has to
      // contain one.
      loadEnvironment({ ...valid, REDIS_URL: 'http://user:hunter2@host' }); // trufflehog:ignore
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain('hunter2');
    }
  });

  it('rejects a production config where runtime and migration roles match', () => {
    // Sharing the role would make the runtime connection the schema owner,
    // which silently disables RLS enforcement for it (ADR-005).
    expect(() =>
      loadEnvironment({
        ...valid,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://same_role:pw@db/vautrin', // trufflehog:ignore
        DATABASE_MIGRATION_URL: 'postgresql://same_role:pw@db/vautrin', // trufflehog:ignore
      }),
    ).toThrow(/must not own the schema/);
  });

  it('allows distinct roles in production', () => {
    expect(() => loadEnvironment({ ...valid, NODE_ENV: 'production' })).not.toThrow();
  });
});

describe('JWT_SECRET (ADR-013)', () => {
  it('is required', () => {
    const { JWT_SECRET: _omitted, ...withoutSecret } = valid;
    expect(() => loadEnvironment(withoutSecret)).toThrow(/JWT_SECRET/);
  });

  it('rejects a short secret', () => {
    // HS256 keyed with less entropy than its output is a weak signature.
    expect(() => loadEnvironment({ ...valid, JWT_SECRET: 'too-short' })).toThrow(
      /at least 32 characters/,
    );
  });

  it('refuses the published development value in production', () => {
    // .env.example ships this, so it is public. Signing real tokens with it
    // means anyone can forge one.
    expect(() =>
      loadEnvironment({
        ...valid,
        NODE_ENV: 'production',
        JWT_SECRET: DEV_JWT_SECRET,
      }),
    ).toThrow(/development value/);
  });

  it('allows the development value outside production', () => {
    expect(() => loadEnvironment({ ...valid, JWT_SECRET: DEV_JWT_SECRET })).not.toThrow();
  });
});
