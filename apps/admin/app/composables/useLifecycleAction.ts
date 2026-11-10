export interface LifecycleAction {
  path: string;
  title: string;
  description: string;
  method?: 'POST' | 'DELETE';
  confirmation?: string;
}
export function useLifecycleAction(onComplete: () => Promise<unknown>) {
  const api = useAdminApi();
  const action = ref<LifecycleAction | null>(null);
  const busy = ref(false);
  const error = ref('');
  function open(value: LifecycleAction) {
    error.value = '';
    action.value = value;
  }
  async function confirm(payload: { reason: string; confirmation: string }) {
    if (!action.value || busy.value) return;
    busy.value = true;
    error.value = '';
    try {
      await api(action.value.path, { method: action.value.method ?? 'POST', body: payload });
      action.value = null;
      await onComplete();
    } catch (cause) {
      error.value = adminError(cause);
    } finally {
      busy.value = false;
    }
  }
  return { action, busy, error, open, confirm };
}
export function userLifecycleAction(
  id: string,
  name: string,
  action: 'disable' | 'enable' | 'delete',
): LifecycleAction {
  return {
    path: `/users/${id}${action === 'delete' ? '' : `/${action}`}`,
    method: action === 'delete' ? 'DELETE' : 'POST',
    title: `${action === 'delete' ? 'Delete' : action === 'disable' ? 'Disable' : 'Enable'} ${name}?`,
    description:
      action === 'delete'
        ? 'This removes the user from active use, revokes sessions, and deactivates memberships. Historical and audit references are preserved. This is not a permanent data purge.'
        : action === 'disable'
          ? 'The user will be signed out and unable to log in. Memberships and historical records are preserved.'
          : 'The user can sign in again. They must create a new session.',
    ...(action === 'delete' ? { confirmation: 'DELETE' } : {}),
  };
}
