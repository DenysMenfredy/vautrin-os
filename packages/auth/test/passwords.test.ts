import { describe, expect, it } from 'vitest';

import { DUMMY_PASSWORD_DIGEST, hashPassword, verifyPassword } from '../src/passwords.js';

describe('password hashing', () => {
  it('round-trips a password', async () => {
    const digest = await hashPassword('correct horse battery staple');
    expect(await verifyPassword(digest, 'correct horse battery staple')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const digest = await hashPassword('correct horse battery staple');
    expect(await verifyPassword(digest, 'Correct horse battery staple')).toBe(false);
  });

  it('produces a different digest each time', async () => {
    // Per-hash salt: two users with the same password must not be visibly
    // identical in the database.
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toBe(b);
  });

  it('uses argon2id at the documented cost', async () => {
    const digest = await hashPassword('x');
    expect(digest.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
  });

  it('returns false instead of throwing on a corrupt digest', async () => {
    expect(await verifyPassword('not-a-digest', 'x')).toBe(false);
    expect(await verifyPassword('', 'x')).toBe(false);
  });

  describe('DUMMY_PASSWORD_DIGEST', () => {
    it('never matches', async () => {
      expect(await verifyPassword(DUMMY_PASSWORD_DIGEST, 'password')).toBe(false);
      expect(await verifyPassword(DUMMY_PASSWORD_DIGEST, '')).toBe(false);
    });

    it('parses, so verification actually does the work', async () => {
      // The point of the dummy is to burn the same CPU as a real check. If
      // it were malformed, verify() would throw and return early, and the
      // "unknown email" path would be measurably faster than "wrong
      // password" — which is how account enumeration works.
      const realDigest = await hashPassword('reference');

      const dummyStart = performance.now();
      await verifyPassword(DUMMY_PASSWORD_DIGEST, 'attempt');
      const dummyMs = performance.now() - dummyStart;

      const realStart = performance.now();
      await verifyPassword(realDigest, 'attempt');
      const realMs = performance.now() - realStart;

      // Generous bound: this asserts "same order of magnitude", not a
      // precise timing, so it does not flake on a loaded CI runner.
      expect(dummyMs).toBeGreaterThan(realMs / 10);
    });
  });
});
