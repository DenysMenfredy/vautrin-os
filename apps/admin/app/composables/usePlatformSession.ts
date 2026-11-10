import type { PlatformPermission, PlatformSessionResponse } from '@vautrin/contracts';
export function usePlatformSession() {
  const session = useState<PlatformSessionResponse | null>('platform-session', () => null);
  const ready = useState('platform-session-ready', () => false);
  const api = useAdminApi();
  async function restore() {
    try {
      session.value = await api<PlatformSessionResponse>('/session');
    } catch {
      session.value = null;
    } finally {
      ready.value = true;
    }
    return session.value !== null;
  }
  async function login(email: string, password: string) {
    session.value = await api<PlatformSessionResponse>('/session', {
      method: 'POST',
      body: { email, password },
    });
    ready.value = true;
  }
  async function logout() {
    await api('/session', { method: 'DELETE' });
    session.value = null;
    await navigateTo('/login');
  }
  return {
    session,
    ready,
    restore,
    login,
    logout,
    can: (permission: PlatformPermission) =>
      session.value?.permissions.includes(permission) ?? false,
  };
}
