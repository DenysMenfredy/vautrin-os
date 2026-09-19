import type { ReadinessResponse } from '@vautrin/contracts';

/**
 * Reads the API readiness probe.
 *
 * The response type comes from @vautrin/contracts, not from a shape declared
 * here — SDD-02 §6. If the API changes the payload, this fails to compile
 * instead of silently rendering undefined.
 *
 * `retry: false` keeps a dashboard tile from stalling the whole page render
 * when the API is down: the call fails once, `error` is populated, and the
 * component shows an unreachable state. `data` is null in that case, which
 * is why callers use optional access on it.
 */
export function useApiHealth() {
  const base = useApiBase();

  return useFetch<ReadinessResponse>(`${base}/health/ready`, {
    key: 'api-health',
    retry: false,
  });
}
