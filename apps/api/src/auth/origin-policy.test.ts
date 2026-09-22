import { loadEnvironment } from '@vautrin/config';
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';

import { assertTrustedOrigin } from './origin-policy.js';

const environment = loadEnvironment({
  DATABASE_URL: 'postgresql://vautrin_app:pw@localhost/vautrin',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(48),
  TRUSTED_ORIGINS: 'https://app.example.com',
});

function requestWithOrigin(origin?: string): Request {
  return {
    header(name: string): string | undefined {
      return name.toLowerCase() === 'origin' ? origin : undefined;
    },
  } as Request;
}

describe('trusted cookie origin policy', () => {
  it('allows an exact configured origin', () => {
    expect(() =>
      assertTrustedOrigin(requestWithOrigin('https://app.example.com'), environment),
    ).not.toThrow();
  });

  it('rejects an untrusted origin', () => {
    expect(() =>
      assertTrustedOrigin(requestWithOrigin('https://evil.example'), environment),
    ).toThrow(/Untrusted request origin/);
  });

  it('allows clients that do not send an Origin header', () => {
    expect(() => assertTrustedOrigin(requestWithOrigin(), environment)).not.toThrow();
  });
});
