import { hash, verify } from '@node-rs/argon2';

/**
 * Password hashing (SDD-09 §7).
 *
 * Argon2id at OWASP's recommended parameters: 19 MiB of memory, 2
 * iterations, parallelism 1. The memory cost is what makes GPU cracking
 * expensive, and it is the parameter to raise over time rather than the
 * iteration count.
 *
 * The salt is generated per hash and encoded in the returned string, so
 * there is no separate salt column.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Hashes a plaintext password. The result is safe to store. */
export function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, ARGON2_OPTIONS);
}

/**
 * Verifies a password against a stored digest.
 *
 * Returns false rather than throwing on a malformed digest: a corrupted row
 * should fail the login, not crash the request handler.
 */
export async function verifyPassword(digest: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(digest, plaintext, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

/**
 * A digest to verify against when the user does not exist.
 *
 * Without this, "unknown email" returns in microseconds while "wrong
 * password" takes a full Argon2 verification, and the difference enumerates
 * accounts. The login path always performs one verification, real or not.
 *
 * This is a genuine digest of a placeholder, not a hand-written string: an
 * unparseable value would make verify() throw immediately and reintroduce
 * exactly the timing difference it exists to remove. A test asserts it
 * still parses.
 */
export const DUMMY_PASSWORD_DIGEST =
  '$argon2id$v=19$m=19456,t=2,p=1$/EKR/5to1U3VxzTiiYfKPQ$Plb8Ht+J2D6uWOGyvshaoM4kn+SdoN+1C/d7T5HfanU';
