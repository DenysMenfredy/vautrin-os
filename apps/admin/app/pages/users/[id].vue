<script setup lang="ts">
import type {
  PlatformAuditPage,
  PlatformMembership,
  PlatformRoleName,
  PlatformUserDetail,
  TenantRoleName,
} from '@vautrin/contracts';

const route = useRoute();
const api = useAdminApi();
const { can, session } = usePlatformSession();
const id = computed(() => String(route.params.id));
const {
  data: user,
  pending,
  error,
  refresh,
} = await useAsyncData(
  () => `platform-user-${id.value}`,
  () => api<PlatformUserDetail>(`/users/${id.value}`),
);
const membershipList = useAdminList<PlatformMembership>(`/users/${id.value}/memberships`);
const { data: activity, refresh: refreshActivity } = await useAsyncData(
  () => `platform-user-audit-${id.value}`,
  () =>
    api<PlatformAuditPage>('/audit', {
      query: { targetType: 'user', targetId: id.value, limit: 5 },
    }),
);
const name = ref(user.value?.name ?? '');
const tenantId = ref('');
const memberRole = ref<TenantRoleName>('STAFF');
const accessRole = ref<PlatformRoleName>(user.value?.platformAccess?.role ?? 'OPERATOR');
const accessStatus = ref<'ACTIVE' | 'SUSPENDED'>(user.value?.platformAccess?.status ?? 'ACTIVE');
const accessReason = ref('');
const busy = ref(false);
const saveError = ref('');
const notice = ref('');
const editable = computed(
  () =>
    can('user.edit') &&
    (!user.value?.protectedIdentity || can('access.manage')) &&
    user.value?.status !== 'DELETED',
);
async function reload() {
  await Promise.all([refresh(), membershipList.reload(), refreshActivity()]);
}
const lifecycle = useLifecycleAction(reload);
async function save(operation: () => Promise<unknown>, message: string) {
  busy.value = true;
  saveError.value = '';
  notice.value = '';
  try {
    await operation();
    notice.value = message;
    await reload();
  } catch (cause) {
    saveError.value = adminError(cause);
  } finally {
    busy.value = false;
  }
}
function changeRole(membership: PlatformMembership, event: Event) {
  const role = (event.target as HTMLSelectElement).value;
  return save(
    () =>
      api(`/users/${id.value}/memberships/${membership.id}`, { method: 'PATCH', body: { role } }),
    'Tenant role updated. Affected tenant sessions were revoked.',
  );
}
function removeMembership(membership: PlatformMembership) {
  lifecycle.open({
    path: `/users/${id.value}/memberships/${membership.id}`,
    method: 'DELETE',
    title: `Remove ${membership.tenantName} membership?`,
    description:
      'The global identity and historical records remain. Sessions for this business will be revoked.',
    confirmation: 'REMOVE',
  });
}
function setLifecycle(action: 'disable' | 'enable' | 'delete') {
  if (user.value)
    lifecycle.open(userLifecycleAction(id.value, user.value.name ?? user.value.email, action));
}
useHead({ title: () => user.value?.name ?? 'User detail' });
</script>
<template>
  <div>
    <NuxtLink class="admin-back-link" to="/users">
      ← Users
    </NuxtLink><AdminState :pending="pending" :error="error ? adminError(error) : ''" @retry="refresh()">
      <template v-if="user">
        <header class="admin-page-header">
          <div>
            <p class="eyebrow">
              Identity / {{ user.id.slice(0, 8) }}
            </p><h1>{{ user.name ?? 'User identity' }}<span class="heading-dot">.</span></h1><p class="muted">
              {{ user.email }}
            </p>
          </div><div class="form-actions">
            <PlatformStatus :status="user.status" /><button v-if="can('user.disable') && editable && ['ACTIVE','DISABLED'].includes(user.status)" class="button button--secondary" @click="setLifecycle(user.status === 'ACTIVE' ? 'disable' : 'enable')">
              {{ user.status === 'ACTIVE' ? 'Disable user' : 'Enable user' }}
            </button><button v-if="can('user.delete') && id !== session?.user.id && user.status !== 'DELETED'" class="button button--danger" @click="setLifecycle('delete')">
              Delete user
            </button>
          </div>
        </header><p v-if="saveError" class="notice notice--error" role="alert">
          {{ saveError }}
        </p><p v-if="notice" class="notice" role="status">
          {{ notice }}
        </p><div class="admin-detail-grid">
          <section class="admin-panel admin-panel-padding">
            <h2>Identity</h2><form class="form-stack" @submit.prevent="save(() => api(`/users/${id}`, {method: 'PATCH', body: {name}}), 'Profile updated.')">
              <div class="field">
                <label for="profile-name">Display name</label><input
                  id="profile-name"
                  v-model="name"
                  :disabled="!editable || busy"
                  required
                  maxlength="200"
                >
              </div><dl class="admin-facts">
                <dt>Email</dt><dd>{{ user.email }}</dd><dt>Created</dt><dd>{{ adminDate(user.createdAt) }}</dd><dt>Last login</dt><dd>{{ adminDate(user.lastLoginAt) }}</dd><dt>Disabled</dt><dd>{{ adminDate(user.disabledAt) }}</dd>
              </dl><button v-if="editable" class="button button--secondary" :disabled="busy">
                Save profile
              </button>
            </form>
          </section><section class="admin-panel admin-panel-padding">
            <h2>Security &amp; sessions</h2><p class="muted">
              Session counts only. Credentials and token material are never displayed.
            </p><dl class="admin-facts">
              <dt>Tenant sessions</dt><dd>{{ user.sessions.tenantSessions }}</dd><dt>Admin sessions</dt><dd>{{ user.sessions.adminSessions }}</dd><dt>Platform identity</dt><dd>{{ user.protectedIdentity ? 'Explicit platform access' : 'No platform access' }}</dd><dt>Lifecycle</dt><dd><PlatformStatus :status="user.status" /></dd>
            </dl>
          </section>
        </div><section class="admin-panel">
          <div class="admin-panel-heading">
            <div>
              <h2>Tenant memberships</h2><p class="small muted">
                A membership controls access to one business.
              </p>
            </div>
          </div><AdminState
            :pending="membershipList.pending.value"
            :error="membershipList.error.value"
            :empty="!membershipList.page.value?.items.length"
            empty-message="This identity has no tenant memberships."
            @retry="membershipList.reload"
          >
            <div class="admin-table-scroll">
              <table>
                <thead><tr><th>Tenant</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>
                  <tr v-for="membership in membershipList.page.value?.items" :key="membership.id">
                    <td>
                      <NuxtLink class="link" :to="`/tenants/${membership.tenantId}`">
                        {{ membership.tenantName }}
                      </NuxtLink>
                    </td><td>
                      <select
                        v-if="can('membership.manage') && editable && membership.status === 'ACTIVE'"
                        class="control"
                        :value="membership.role"
                        :disabled="busy"
                        aria-label="Tenant role"
                        @change="changeRole(membership, $event)"
                      >
                        <option v-for="role in ['OWNER','ADMIN','MANAGER','STAFF','READ_ONLY']" :key="role">
                          {{ role }}
                        </option>
                      </select><span v-else>{{ membership.role }}</span>
                    </td><td><PlatformStatus :status="membership.status" /></td><td>
                      <button v-if="can('membership.manage') && editable && membership.status !== 'REVOKED'" class="text-button danger-text" @click="removeMembership(membership)">
                        Remove
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </AdminState><AdminPagination
            :next-cursor="membershipList.page.value?.nextCursor ?? null"
            :has-previous="membershipList.history.value.length > 0"
            :pending="membershipList.pending.value"
            :count="membershipList.page.value?.items.length ?? 0"
            @next="membershipList.next"
            @previous="membershipList.previous"
          /><form v-if="can('membership.manage') && editable && user.status === 'ACTIVE'" class="admin-inline-form form-stack" @submit.prevent="save(() => api(`/users/${id}/memberships`, {method: 'POST', body: {tenantId, role: memberRole}}), 'Membership created.')">
            <h3>Add existing user to a tenant</h3><TenantPicker v-model="tenantId" required /><label class="field">Tenant role<select v-model="memberRole"><option v-for="role in ['OWNER','ADMIN','MANAGER','STAFF','READ_ONLY']" :key="role">{{ role }}</option></select></label><button class="button button--secondary" :disabled="busy || !tenantId">
              Add membership
            </button>
          </form>
        </section><section v-if="can('access.manage') && user.status === 'ACTIVE'" class="admin-panel admin-panel-padding">
          <h2>Platform access</h2><p class="muted">
            This privilege is independent of all tenant roles. Changes revoke existing admin sessions.
          </p><form class="form-grid" @submit.prevent="save(() => api(`/users/${id}/platform-access`, {method: 'PATCH', body: {role: accessRole, status: accessStatus, reason: accessReason}}), 'Platform access updated.')">
            <label class="field">Platform role<select v-model="accessRole"><option v-for="role in ['SUPER_ADMIN','OPERATOR','SUPPORT_READ_ONLY']" :key="role">{{ role }}</option></select></label><label class="field">Status<select v-model="accessStatus"><option>ACTIVE</option><option>SUSPENDED</option></select></label><label class="field">Reason<input v-model="accessReason" required minlength="3" maxlength="500"></label><div class="field">
              <span class="small muted">The last active SUPER_ADMIN is protected.</span><button class="button button--secondary" :disabled="busy">
                {{ user.platformAccess ? 'Update platform access' : 'Grant platform access' }}
              </button>
            </div>
          </form>
        </section><section class="admin-panel">
          <div class="admin-panel-heading">
            <h2>Recent identity activity</h2><NuxtLink class="link small" :to="{path: '/audit', query: {targetType: 'user', targetId: id}}">
              Full history →
            </NuxtLink>
          </div><AdminAuditTable v-if="activity?.items.length" :items="activity.items" /><p v-else class="admin-state">
            No platform activity for this identity yet.
          </p>
        </section>
      </template>
    </AdminState><AdminActionDialog
      v-if="lifecycle.action.value"
      v-bind="lifecycle.action.value"
      :busy="lifecycle.busy.value"
      :error="lifecycle.error.value"
      @cancel="lifecycle.action.value = null"
      @confirm="lifecycle.confirm"
    />
  </div>
</template>
