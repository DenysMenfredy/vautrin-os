<script setup lang="ts">
import type { PlatformAuditPage, PlatformTenantDetail, PlatformUser } from '@vautrin/contracts';

const route = useRoute();
const api = useAdminApi();
const { can } = usePlatformSession();
const id = computed(() => String(route.params.id));
const {
  data: tenant,
  pending,
  error,
  refresh,
} = await useAsyncData(
  () => `platform-tenant-${id.value}`,
  () => api<PlatformTenantDetail>(`/tenants/${id.value}`),
);
const users = useAdminList<PlatformUser>('/users', { tenantId: id.value });
const { data: activity, refresh: refreshActivity } = await useAsyncData(
  () => `platform-tenant-audit-${id.value}`,
  () => api<PlatformAuditPage>('/audit', { query: { tenantId: id.value, limit: 5 } }),
);
const name = ref(tenant.value?.name ?? '');
const timezone = ref(tenant.value?.timezone ?? 'UTC');
const template = ref(tenant.value?.vertical ?? 'remodeling');
const busy = ref(false);
const saveError = ref('');
const notice = ref('');
const showInvite = ref(false);
async function reload() {
  await Promise.all([refresh(), users.reload(), refreshActivity()]);
}
const lifecycle = useLifecycleAction(reload);
function setLifecycle(action: 'suspend' | 'reactivate' | 'archive') {
  lifecycle.open({
    path: `/tenants/${id.value}/${action}`,
    title: `${action === 'suspend' ? 'Suspend' : action === 'archive' ? 'Archive' : 'Reactivate'} ${tenant.value?.name}?`,
    description:
      action === 'archive'
        ? 'Archive this business without deleting its historical data. Access and pending invitations are revoked. Archived businesses cannot be reactivated through this console.'
        : action === 'suspend'
          ? 'Business access is suspended, tenant sessions are revoked and automation cannot access its business data. Historical records remain. This is reversible.'
          : 'Restore business access. Users must sign in again. Revoked invitations remain invalid.',
    ...(action === 'archive' ? { confirmation: 'ARCHIVE' } : {}),
  });
}
async function save() {
  busy.value = true;
  saveError.value = '';
  try {
    await api(`/tenants/${id.value}`, {
      method: 'PATCH',
      body: { name: name.value, timezone: timezone.value, template: template.value },
    });
    notice.value = 'Tenant metadata updated.';
    await reload();
  } catch (cause) {
    saveError.value = adminError(cause);
  } finally {
    busy.value = false;
  }
}
useHead({ title: () => tenant.value?.name ?? 'Tenant detail' });
</script>
<template>
  <div>
    <NuxtLink class="admin-back-link" to="/tenants">
      ← Tenants
    </NuxtLink><AdminState :pending="pending" :error="error ? adminError(error) : ''" @retry="refresh()">
      <template v-if="tenant">
        <header class="admin-page-header">
          <div>
            <p class="eyebrow">
              Business / {{ tenant.slug }}
            </p><h1>{{ tenant.name }}<span class="heading-dot">.</span></h1><p class="muted">
              {{ tenant.timezone ?? 'Timezone not configured' }} · {{ tenant.vertical.replaceAll('-', ' ') }}
            </p>
          </div><div class="form-actions">
            <PlatformStatus :status="tenant.status" /><template v-if="can('tenant.manage') && tenant.status !== 'ARCHIVED'">
              <button class="button button--secondary" @click="setLifecycle(tenant.status === 'ACTIVE' ? 'suspend' : 'reactivate')">
                {{ tenant.status === 'ACTIVE' ? 'Suspend tenant' : 'Reactivate tenant' }}
              </button><button class="button button--danger" @click="setLifecycle('archive')">
                Archive
              </button>
            </template>
          </div>
        </header><p v-if="notice" class="notice" role="status">
          {{ notice }}
        </p><p v-if="saveError" class="notice notice--error" role="alert">
          {{ saveError }}
        </p><div class="admin-detail-grid">
          <section class="admin-panel admin-panel-padding">
            <h2>Business metadata</h2><form class="form-stack" @submit.prevent="save">
              <div class="field">
                <label for="edit-tenant-name">Business name</label><input
                  id="edit-tenant-name"
                  v-model="name"
                  required
                  minlength="2"
                  maxlength="200"
                  :disabled="!can('tenant.manage')"
                >
              </div><div class="field">
                <label for="edit-timezone">Timezone</label><input id="edit-timezone" v-model="timezone" required :disabled="!can('tenant.manage')">
              </div><div class="field">
                <label for="edit-template">Vertical</label><select id="edit-template" v-model="template" :disabled="!can('tenant.manage')">
                  <option value="remodeling">
                    Remodeling / home services
                  </option><option value="generic-local-business">
                    Local business
                  </option>
                </select>
              </div><button v-if="can('tenant.manage')" class="button button--secondary" :disabled="busy">
                {{ busy ? 'Saving…' : 'Save metadata' }}
              </button>
            </form>
          </section><section class="admin-panel admin-panel-padding">
            <h2>Tenant summary</h2><dl class="admin-facts">
              <dt>Created</dt><dd>{{ adminDate(tenant.createdAt) }}</dd><dt>Members</dt><dd>{{ tenant.userCount }} total · {{ tenant.activeUserCount }} active</dd><dt>Pending invitations</dt><dd>{{ tenant.pendingInvitations }}</dd><dt>Locale / currency</dt><dd>{{ tenant.businessProfile?.locale ?? '—' }} / {{ tenant.businessProfile?.currency ?? '—' }}</dd><dt>Tenant ID</dt><dd class="mono wrap-id">
                {{ tenant.id }}
              </dd>
            </dl><button v-if="can('user.invite') && tenant.status === 'ACTIVE'" class="button button--primary" @click="showInvite = !showInvite">
              {{ showInvite ? 'Close invitation' : 'Invite OWNER or member' }}
            </button>
          </section>
        </div><section v-if="showInvite" class="admin-panel admin-inline-form">
          <h2>Invite a business user</h2><InviteUserForm :tenant-id="id" @issued="reload" />
        </section><section class="admin-panel">
          <div class="admin-panel-heading">
            <h2>Current business users</h2><NuxtLink class="link small" :to="{path: '/users', query: {tenantId: id}}">
              Manage users →
            </NuxtLink>
          </div><AdminState
            :pending="users.pending.value"
            :error="users.error.value"
            :empty="!users.page.value?.items.length"
            empty-message="No active business memberships. Invite the first OWNER when ready."
            @retry="users.reload"
          >
            <div class="admin-table-scroll">
              <table>
                <thead><tr><th>User</th><th>Status</th><th>Role</th><th>Actions</th></tr></thead><tbody>
                  <tr v-for="user in users.page.value?.items" :key="user.id">
                    <td>{{ user.name ?? user.email }}<span class="table-subline">{{ user.email }}</span></td><td><PlatformStatus :status="user.status" /></td><td>{{ user.memberships.find((membership) => membership.tenantId === id)?.role ?? '—' }}</td><td>
                      <NuxtLink class="link" :to="`/users/${user.id}`">
                        View user →
                      </NuxtLink>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </AdminState><AdminPagination
            :next-cursor="users.page.value?.nextCursor ?? null"
            :has-previous="users.history.value.length > 0"
            :pending="users.pending.value"
            :count="users.page.value?.items.length ?? 0"
            @next="users.next"
            @previous="users.previous"
          />
        </section><section class="admin-panel">
          <div class="admin-panel-heading">
            <h2>Recent tenant activity</h2><NuxtLink class="link small" :to="{path: '/audit', query: {tenantId: id}}">
              Full history →
            </NuxtLink>
          </div><AdminAuditTable v-if="activity?.items.length" :items="activity.items" /><p v-else class="admin-state">
            No platform activity for this tenant yet.
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
