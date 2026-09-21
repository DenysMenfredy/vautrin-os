import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { type JWTPayload, jwtVerify, SignJWT } from 'jose';

import type { Role } from './capabilities.js';

/**
 * Access and refresh tokens (ADR-013).
 *
 * Access tokens are short-lived JWTs verified from the signature alone.
 * Refresh tokens are opaque, stored hashed, and rotated on every use.
 */

/** Thrown when an access token is absent, malformed, expired or unsigned by us. */
export class InvalidAccessTokenError extends Error {
  override readonly name = 'InvalidAccessTokenError';
}

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

const ISSUER = 'vautrin-os';
const AUDIENCE = 'vautrin-os/api';

export interface AccessTokenClaims {
  /** User id. */
  readonly sub: string;
  /** Active tenant. Absent when the user has selected no tenant yet. */
  readonly tid?: string;
  /** Role within the active tenant. Absent when `tid` is. */
  readonly role?: Role;
  /** Token id, for correlating a request with the credential that made it. */
  readonly jti: string;
}

export interface SignAccessTokenInput {
  readonly userId: string;
  readonly tenantId?: string;
  readonly role?: Role;
  readonly secret: Uint8Array;
  /** Override the lifetime. Tests use this; application code should not. */
  readonly ttlSeconds?: number;
}

/**
 * Issues an access token.
 *
 * Capabilities are deliberately absent: they are derived from `role` at
 * request time, so the capability model can change without invalidating
 * every token in circulation (ADR-013).
 */
export function signAccessToken(input: SignAccessTokenInput): Promise<string> {
  const jti = randomBytes(16).toString('hex');

  const builder = new SignJWT({
    ...(input.tenantId !== undefined ? { tid: input.tenantId } : {}),
    ...(input.role !== undefined ? { role: input.role } : {}),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(input.userId)
    .setJti(jti)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${input.ttlSeconds ?? ACCESS_TOKEN_TTL_SECONDS}s`);

  return builder.sign(input.secret);
}

/**
 * Verifies an access token and returns its claims.
 *
 * Issuer and audience are checked, not just the signature: a token minted
 * for a different service but signed with a shared secret must not be
 * accepted here.
 */
export async function verifyAccessToken(
  token: string,
  secret: Uint8Array,
): Promise<AccessTokenClaims> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    }));
  } catch (error) {
    // The reason is useful in a log, never to the caller: distinguishing
    // "expired" from "bad signature" is free information for an attacker.
    throw new InvalidAccessTokenError(
      error instanceof Error ? error.message : 'Access token verification failed',
    );
  }

  if (typeof payload.sub !== 'string' || typeof payload.jti !== 'string') {
    throw new InvalidAccessTokenError('Access token is missing sub or jti.');
  }

  const { tid, role } = payload;

  return {
    sub: payload.sub,
    jti: payload.jti,
    ...(typeof tid === 'string' ? { tid } : {}),
    ...(typeof role === 'string' ? { role: role as Role } : {}),
  };
}

// ---------------------------------------------------------------------------
// Refresh tokens
// ---------------------------------------------------------------------------

export interface GeneratedRefreshToken {
  /** Returned to the client once. Never stored. */
  readonly token: string;
  /** Stored in place of the token. */
  readonly tokenHash: string;
}

/**
 * Mints a refresh token.
 *
 * 256 bits from the CSPRNG, base64url encoded. Opaque on purpose: there is
 * nothing for a client to read, and an opaque string is inert if it ends up
 * in a log or a proxy trace.
 */
export function generateRefreshToken(): GeneratedRefreshToken {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashRefreshToken(token) };
}

/**
 * Hashes a refresh token for storage.
 *
 * Plain SHA-256, not Argon2 — and that is deliberate. A refresh token is
 * 256 bits of uniform randomness, so there is no dictionary to attack and
 * nothing for a slow hash to buy. It is looked up on every refresh, where a
 * 50ms KDF would be a real cost for no security gain.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Compares two refresh-token hashes in constant time.
 *
 * Lookups go through the unique index on `token_hash`, so this is for the
 * cases where a hash is compared in application code.
 */
export function refreshTokenHashEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Expiry instant for a newly issued refresh token. */
export function refreshTokenExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000);
}
