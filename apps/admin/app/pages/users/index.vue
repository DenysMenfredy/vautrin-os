<script setup lang="ts">
import type { PlatformUser } from '@vautrin/contracts';

const { can, session } = usePlatformSession();
const { filters, page, pending, error, history, reload, next, previous } =
  useAdminList<PlatformUser>('/users', {
    q: '',
    status: '',
    tenantId:
      typeof useRoute().query.tenantId === 'string' ? String(useRoute().query.tenantId) : '',
    role: '',
    createdFrom: '',
    createdTo: '',
  });
const showInvite = ref(false);
const lifecycle = useLifecycleAction(reload);
function manage(row: PlatformUser, action: 'disable' | 'enable' | 'delete') {
  lifecycle.open(userLifecycleAction(row.id, row.name ?? row.email, action));
}
function editable(row: PlatformUser) {
  return !row.protectedIdentity || can('access.manage');
}
useHead({ title: 'Users' });
</script>
<template>
  <div>
    <header class="admin-page-header">
      <div>
        <p class="eyebrow">
          Control plane / Identity
        </p><h1>Users<span class="heading-dot">.</span></h1><p class="muted">
          Global identities and their business memberships.
        </p>
      </div><button v-if="can('user.invite')" class="button button--primary" @click="showInvite = !showInvite">
        {{ showInvite ? 'Close invitation' : 'Invite user' }}
      </button>
    </header><section v-if="showInvite" class="admin-panel admin-inline-form">
      <h2>Invite a customer user</h2><InviteUserForm @issued="reload" />
    </section><section class="admin-panel">
      <form class="admin-filters" @submit.prevent="reload">
        <label class="field admin-search">Search<input v-model="filters.q" type="search" placeholder="Name or email"></label><label class="field">Status<select v-model="filters.status"><option value="">All current users</option><option v-for="status in ['PENDING','ACTIVE','DISABLED','DELETED']" :key="status" :value="status">{{ status }}</option></select></label><label class="field">Tenant ID<input v-model="filters.tenantId" placeholder="Optional UUID"></label><label class="field">Tenant role<select v-model="filters.role"><option value="">All roles</option><option v-for="role in ['OWNER','ADMIN','MANAGER','STAFF','READ_ONLY']" :key="role" :value="role">{{ role }}</option></select></label><label class="field">Created from<input v-model="filters.createdFrom" type="date"></label><label class="field">Created to<input v-model="filters.createdTo" type="date"></label><button class="button button--secondary" :disabled="pending">
          Search users
        </button>
      </form><AdminState :pending="pending" :error="error" :empty="!page?.items.length" @retry="reload">
        <div class="admin-table-scroll">
          <table>
            <thead><tr><th>User</th><th>Status</th><th>Tenants</th><th>Created</th><th>Last login</th><th>Actions</th></tr></thead><tbody>
              <tr v-for="user in page?.items" :key="user.id">
                <td>
                  <NuxtLink class="strong" :to="`/users/${user.id}`">
                    {{ user.name ?? 'Unnamed user' }}
                  </NuxtLink><span class="table-subline">{{ user.email }}</span>
                </td><td><PlatformStatus :status="user.status" /><span v-if="user.protectedIdentity" class="table-subline">Platform identity</span></td><td><span v-if="!user.memberships.length" class="muted">No memberships</span><span v-for="membership in user.memberships.slice(0, 2)" :key="membership.id" class="table-subline"><NuxtLink :to="`/tenants/${membership.tenantId}`">{{ membership.tenantName }}</NuxtLink> · {{ membership.role }}</span></td><td class="small">
                  {{ adminDate(user.createdAt) }}
                </td><td class="small">
                  {{ adminDate(user.lastLoginAt) }}
                </td><td>
                  <div class="table-actions">
                    <NuxtLink class="link" :to="`/users/${user.id}`">
                      View
                    </NuxtLink><button v-if="can('user.disable') && editable(user) && ['ACTIVE','DISABLED'].includes(user.status)" class="text-button" @click="manage(user, user.status === 'ACTIVE' ? 'disable' : 'enable')">
                      {{ user.status === 'ACTIVE' ? 'Disable' : 'Enable' }}
                    </button><button v-if="can('user.delete') && user.id !== session?.user.id && user.status !== 'DELETED'" class="text-button danger-text" @click="manage(user, 'delete')">
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </AdminState><AdminPagination
        :next-cursor="page?.nextCursor ?? null"
        :has-previous="history.length > 0"
        :pending="pending"
        :count="page?.items.length ?? 0"
        @next="next"
        @previous="previous"
      />
    </section><AdminActionDialog
      v-if="lifecycle.action.value"
      v-bind="lifecycle.action.value"
      :busy="lifecycle.busy.value"
      :error="lifecycle.error.value"
      @cancel="lifecycle.action.value = null"
      @confirm="lifecycle.confirm"
    />
  </div>
</template>
