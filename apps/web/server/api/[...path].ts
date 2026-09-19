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
 */
export default defineEventHandler((event) => {
  const { apiInternalBase } = useRuntimeConfig(event);
  const path = getRouterParam(event, 'path') ?? '';
  const query = getRequestURL(event).search;

  return proxyRequest(event, `${apiInternalBase}/${path}${query}`);
});
