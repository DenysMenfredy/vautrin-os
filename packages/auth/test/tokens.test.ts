import { describe, expect, it } from 'vitest';

import {
  ACCESS_TOKEN_TTL_SECONDS,
  generateRefreshToken,
  hashRefreshToken,
  InvalidAccessTokenError,
  refreshTokenExpiry,
  refreshTokenHashEquals,
  signAccessToken,
  verifyAccessToken,
} from '../src/tokens.js';

const secret = new TextEncoder().encode('a'.repeat(48));
const otherSecret = new TextEncoder().encode('b'.repeat(48));

describe('access tokens', () => {
  it('round-trips claims', async () => {
    const token = await signAccessToken({
      userId: '0192f1a0-1b2c-7d3e-8f40-51627384950a',
      tenantId: '0192f1a0-1b2c-7d3e-8f40-51627384950b',
      role: 'MANAGER',
      secret,
    });

    const claims = await verifyAccessToken(token, secret);
    expect(claims.sub).toBe('0192f1a0-1b2c-7d3e-8f40-51627384950a');
    expect(claims.tid).toBe('0192f1a0-1b2c-7d3e-8f40-51627384950b');
    expect(claims.role).toBe('MANAGER');
    expect(claims.jti).toMatch(/^[0-9a-f]{32}$/);
  });

  it('omits tenant claims for a user with no active tenant', async () => {
    const token = await signAccessToken({ userId: 'u', secret });
    const claims = await verifyAccessToken(token, secret);

    expect(claims.tid).toBeUndefined();
    expect(claims.role).toBeUndefined();
  });

  it('does not carry capabilities', async () => {
    // ADR-013: capabilities are derived from role at request time, so the
    // model can change without invalidating tokens in circulation.
    const token = await signAccessToken({ userId: 'u', role: 'OWNER', secret });
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] as string, 'base64url').toString(),
    ) as Record<string, unknown>;

    expect(payload).not.toHaveProperty('capabilities');
    expect(payload).not.toHaveProperty('caps');
  });

  it('rejects a token signed with another secret', async () => {
    const token = await signAccessToken({ userId: 'u', secret: otherSecret });
    await expect(verifyAccessToken(token, secret)).rejects.toThrow(InvalidAccessTokenError);
  });

  it('rejects an expired token', async () => {
    const token = await signAccessToken({ userId: 'u', secret, ttlSeconds: -1 });
    await expect(verifyAccessToken(token, secret)).rejects.toThrow(InvalidAccessTokenError);
  });

  it.each([
    ['empty', ''],
    ['not a jwt', 'abc.def'],
    ['tampered payload', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJoYWNrZXIifQ.x'],
  ])('rejects %s', async (_label, token) => {
    await expect(verifyAccessToken(token, secret)).rejects.toThrow(InvalidAccessTokenError);
  });

  it('rejects an unsigned (alg=none) token', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'attacker' })).toString('base64url');
    await expect(verifyAccessToken(`${header}.${payload}.`, secret)).rejects.toThrow(
      InvalidAccessTokenError,
    );
  });

  it('expires within the documented window', async () => {
    const token = await signAccessToken({ userId: 'u', secret });
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] as string, 'base64url').toString(),
    ) as { exp: number; iat: number };

    expect(payload.exp - payload.iat).toBe(ACCESS_TOKEN_TTL_SECONDS);
  });
});

describe('refresh tokens', () => {
  it('returns the token and its hash, and never the token in the hash', () => {
    const { token, tokenHash } = generateRefreshToken();

    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).not.toContain(token);
    expect(hashRefreshToken(token)).toBe(tokenHash);
  });

  it('produces unguessable, unique tokens', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateRefreshToken().token));
    expect(tokens.size).toBe(500);
    // 32 random bytes, base64url: 43 characters, no padding.
    expect([...tokens][0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('compares hashes without leaking length mismatches as a throw', () => {
    const { tokenHash } = generateRefreshToken();
    expect(refreshTokenHashEquals(tokenHash, tokenHash)).toBe(true);
    expect(refreshTokenHashEquals(tokenHash, 'short')).toBe(false);
  });

  it('expires 30 days out', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    expect(refreshTokenExpiry(from).toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });
});
