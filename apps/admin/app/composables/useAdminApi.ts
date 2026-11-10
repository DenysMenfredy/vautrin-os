import type { PlatformSessionResponse } from '@vautrin/contracts';
export interface AdminRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: object;
  query?: Record<string, string | number | undefined>;
}
export function useAdminApi() {
  const session = useState<PlatformSessionResponse | null>('platform-session', () => null);
  const base = useRuntimeConfig().public.apiBase;
  return async <T>(path: string, options: AdminRequestOptions = {}): Promise<T> => {
    try {
      return (await $fetch<T>(`${base}${path}`, {
        ...options,
        credentials: 'same-origin',
        headers:
          options.method && options.method !== 'GET'
            ? { 'Idempotency-Key': crypto.randomUUID() }
            : {},
      })) as T;
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'statusCode' in error &&
        error.statusCode === 401
      ) {
        session.value = null;
        if (path !== '/session') await navigateTo('/login');
      }
      throw error;
    }
  };
}
export function adminError(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'data' in error &&
    typeof error.data === 'object' &&
    error.data !== null &&
    'message' in error.data
  ) {
    const message = error.data.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message) && message.every((item) => typeof item === 'string'))
      return message.join(' ');
  }
  return 'The request could not be completed. Please try again.';
}
export function adminDate(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(
        new Date(value),
      )
    : '—';
}
