/**
 * Base path for API calls.
 *
 * Always relative, on both the server and the client, because requests go
 * through the Nitro proxy in server/api rather than straight to the API
 * host. Keeping it relative is what makes the request same-origin in the
 * browser; see that handler for why that matters.
 */
export function useApiBase(): string {
  return useRuntimeConfig().public.apiBase;
}
