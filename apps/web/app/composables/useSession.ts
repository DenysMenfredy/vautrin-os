import type { AuthTokensResponse, CurrentSessionResponse } from '@vautrin/contracts';

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type Query = Record<string, string | number | boolean | null | undefined>;

export interface ApiOptions {
  method?: HttpMethod;
  body?: unknown;
  query?: Query;
}

let refreshPromise: Promise<boolean> | null = null;

export function apiErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'data' in error) {
    const data = error.data;
    if (typeof data === 'object' && data !== null && 'message' in data) {
      const message = data.message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message))
        return message.filter((part): part is string => typeof part === 'string').join(' ');
    }
  }
  return 'The request failed. Try again.';
}

export function useSession() {
  const token = useState<string | null>('access-token', () => null);
  const session = useState<CurrentSessionResponse | null>('current-session', () => null);
  const ready = useState<boolean>('session-ready', () => false);
  const base = useApiBase();

  const applyTokens = async (result: AuthTokensResponse): Promise<void> => {
    // The API returns a refresh token for non-browser clients. The browser
    // uses its HttpOnly cookie; never put that token in Nuxt state or storage.
    token.value = result.accessToken;
    session.value = await $fetch<CurrentSessionResponse>(`${base}/auth/me`, {
      headers: { Authorization: `Bearer ${result.accessToken}` },
      credentials: 'same-origin',
    });
    ready.value = true;
  };

  const refresh = (): Promise<boolean> => {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        const result = await $fetch<AuthTokensResponse>(`${base}/auth/refresh`, {
          method: 'POST',
          body: {},
          credentials: 'same-origin',
        });
        await applyTokens(result);
        return true;
      } catch {
        token.value = null;
        session.value = null;
        ready.value = true;
        return false;
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  };

  const restore = (): Promise<boolean> => {
    if (token.value && session.value) {
      ready.value = true;
      return Promise.resolve(true);
    }
    return refresh();
  };

  const login = async (email: string, password: string): Promise<void> => {
    const result = await $fetch<AuthTokensResponse>(`${base}/auth/login`, {
      method: 'POST',
      body: { email, password },
      credentials: 'same-origin',
    });
    await applyTokens(result);
  };

  const request = async <T>(path: string, options: ApiOptions = {}): Promise<T> => {
    if (!token.value && !(await refresh()))
      throw new Error('Your session has ended. Sign in again.');
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== null && value !== undefined && value !== '') query.set(key, String(value));
    }
    const url = `${base}${path}${query.size ? `?${query.toString()}` : ''}`;
    const send = () =>
      $fetch<T>(url, {
        method: options.method ?? 'GET',
        ...(options.body === undefined ? {} : { body: options.body }),
        headers: { Authorization: `Bearer ${token.value}` },
        credentials: 'same-origin',
      });
    try {
      return await send();
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'statusCode' in error &&
        error.statusCode === 401
      ) {
        if (await refresh()) return send();
      }
      throw error;
    }
  };

  const switchTenant = async (tenantId: string): Promise<void> => {
    const result = await request<{ accessToken: string }>('/auth/tenant', {
      method: 'POST',
      body: { tenantId },
    });
    token.value = result.accessToken;
    session.value = await request<CurrentSessionResponse>('/auth/me');
  };

  const logout = async (): Promise<void> => {
    await $fetch(`${base}/auth/logout`, { method: 'POST', body: {}, credentials: 'same-origin' });
    token.value = null;
    session.value = null;
    ready.value = true;
  };

  const can = (capability: string): boolean =>
    Boolean(session.value?.capabilities.includes(capability));

  return { token, session, ready, restore, login, request, switchTenant, logout, can };
}
