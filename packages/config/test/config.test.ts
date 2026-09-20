import { describe, expect, it } from 'vitest';

import { ConfigurationError, loadEnvironment } from '../src/index.js';

const valid = {
  DATABASE_URL: 'postgresql://vautrin_app:pw@localhost:5435/vautrin',
  DATABASE_MIGRATION_URL: 'postgresql://vautrin_migrator:pw@localhost:5435/vautrin',
  REDIS_URL: 'redis://localhost:6379',
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
