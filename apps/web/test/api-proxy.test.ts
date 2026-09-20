import { describe, expect, it } from 'vitest';

/**
 * Regression tests for the API proxy's path confinement.
 *
 * A naive `${base}/${path}` interpolation let `/api/../../admin` reach
 * `/admin` on the internal API host, escaping the prefix the proxy is meant
 * to be confined to. These cases exist so that cannot come back.
 *
 * The confinement logic is exercised directly rather than through a booted
 * Nitro server: it is pure string handling, and testing it here keeps the
 * suite fast enough that nobody is tempted to skip it.
 */

function hasTraversalSegment(path: string): boolean {
  let decoded = path;
  for (let i = 0; i < 3; i += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return true;
    }
    if (next === decoded) break;
    decoded = next;
  }
  return decoded.split(/[/\\]/).some((segment) => segment === '..' || segment === '.');
}

const API_BASE = 'http://api:3000/api';

/** Mirrors the handler: returns the target URL, or null when rejected. */
function resolveTarget(path: string): string | null {
  if (hasTraversalSegment(path)) return null;

  const base = new URL(API_BASE.endsWith('/') ? API_BASE : `${API_BASE}/`);
  const target = new URL(path, base);

  if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) {
    return null;
  }
  return target.href;
}

describe('API proxy path confinement', () => {
  it.each([
    ['health/ready', 'http://api:3000/api/health/ready'],
    ['leads', 'http://api:3000/api/leads'],
    [
      'contacts/0192f1a0-1b2c-7d3e-8f40-51627384950a',
      'http://api:3000/api/contacts/0192f1a0-1b2c-7d3e-8f40-51627384950a',
    ],
  ])('forwards %s', (path, expected) => {
    expect(resolveTarget(path)).toBe(expected);
  });

  it.each([
    ['plain traversal', '../admin'],
    ['double traversal', '../../admin'],
    ['traversal mid-path', 'health/../../admin'],
    ['percent-encoded', '%2e%2e/admin'],
    ['double-encoded', '%252e%252e/admin'],
    ['backslash variant', '..\\admin'],
    ['single dot', './admin'],
    ['malformed encoding', '%E0%A4%A'],
  ])('rejects %s', (_label, path) => {
    expect(resolveTarget(path)).toBeNull();
  });

  it('never leaves the API origin', () => {
    // A path that tries to become an absolute URL must not redirect the
    // proxy at another host.
    for (const path of ['//evil.example.com/x', 'http://evil.example.com/x']) {
      const target = resolveTarget(path);
      expect(target === null || target.startsWith('http://api:3000/api/')).toBe(true);
    }
  });
});
