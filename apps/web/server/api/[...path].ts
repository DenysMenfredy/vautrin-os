/**
 * Same-origin proxy to apps/api.
 *
 * The browser calls `/api/...` on the Nuxt origin and Nitro forwards it to
 * the API. The alternative — the browser calling the API host directly —
 * would mean:
 *
 *   - CORS configuration on every API deployment;
 *   - the API being publicly reachable, not just reachable by the frontend;
 *   - cross-site cookie handling (SameSite=None, credentials) once session
 *     auth lands (VOS-030).
 *
 * Proxying removes all three. The API's location stays server-side
 * configuration (`apiInternalBase`) and is never shipped to the browser.
 *
 * SECURITY — the forwarded path is attacker-controlled.
 *
 * Naively interpolating it lets `/api/../../admin` resolve to `/admin` on
 * the internal API host, escaping the `/api` prefix this proxy is supposed
 * to be confined to. Nothing is mounted outside that prefix today, so the
 * blast radius is currently zero — but the day a metrics or admin route
 * appears, or another service answers on that host, it becomes reachable
 * from the public web origin. That is a proxy turned into an SSRF primitive.
 *
 * Two checks, because each catches what the other misses:
 *
 *   1. Reject a decoded path containing a `..` segment. Catches percent-
 *      encoded forms (`%2e%2e`) that survive URL resolution here and are
 *      then decoded by the receiving server.
 *   2. Resolve against the base with the URL parser and require the result
 *      to stay on the same origin and under the base pathname. Catches
 *      anything the first check does not anticipate.
 */

function hasTraversalSegment(path: string): boolean {
  let decoded = path;
  // Decode repeatedly: a double-encoded `%252e%252e` becomes `..` in two passes.
  for (let i = 0; i < 3; i += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      // Malformed encoding is not something a legitimate client sends.
      return true;
    }
    if (next === decoded) break;
    decoded = next;
  }

  return decoded.split(/[/\\]/).some((segment) => segment === '..' || segment === '.');
}

export default defineEventHandler((event) => {
  const { apiInternalBase } = useRuntimeConfig(event);
  const path = getRouterParam(event, 'path') ?? '';
  const query = getRequestURL(event).search;

  if (hasTraversalSegment(path)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid API path' });
  }

  // Trailing slash matters: without it, URL resolution replaces the last
  // path segment of the base instead of appending to it.
  const base = new URL(apiInternalBase.endsWith('/') ? apiInternalBase : `${apiInternalBase}/`);
  const target = new URL(path, base);

  if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid API path' });
  }

  return proxyRequest(event, `${target.href}${query}`);
});
