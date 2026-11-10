import type { PageResponse } from '@vautrin/contracts';
export function useAdminList<T>(path: string, initialFilters: Record<string, string> = {}) {
  const api = useAdminApi();
  const filters = reactive({ ...initialFilters });
  const page = ref<PageResponse<T> | null>(null);
  const pending = ref(false);
  const error = ref('');
  const cursor = ref<string | undefined>();
  const history = ref<(string | undefined)[]>([]);
  let revision = 0;
  async function load() {
    const version = ++revision;
    pending.value = true;
    error.value = '';
    const query = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ''));
    try {
      const result = await api<PageResponse<T>>(path, {
        query: { ...query, cursor: cursor.value, limit: 25 },
      });
      if (version === revision) page.value = result;
    } catch (cause) {
      if (version === revision) {
        page.value = null;
        error.value = adminError(cause);
      }
    } finally {
      if (version === revision) pending.value = false;
    }
  }
  function reload() {
    cursor.value = undefined;
    history.value = [];
    return load();
  }
  function next() {
    if (!page.value?.nextCursor || pending.value) return;
    history.value.push(cursor.value);
    cursor.value = page.value.nextCursor;
    return load();
  }
  function previous() {
    if (!history.value.length || pending.value) return;
    cursor.value = history.value.pop();
    return load();
  }
  onMounted(load);
  return { filters, page, pending, error, history, load, reload, next, previous };
}
