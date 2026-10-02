/**
 * Base path for API calls.
 *
 * Always relative: Nitro proxies /api during local/container development;
 * the production load balancer sends /api/* straight to apps/api. The
 * browser uses the same origin (and refresh-cookie scope) in both cases.
 */
export function useApiBase(): string {
  return useRuntimeConfig().public.apiBase;
}
