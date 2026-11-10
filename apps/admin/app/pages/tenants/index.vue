<script setup lang="ts">
import type { PlatformTenant } from '@vautrin/contracts';

const { can } = usePlatformSession();
const showCreate = ref(false);
const { filters, page, pending, error, history, reload, next, previous } =
  useAdminList<PlatformTenant>('/tenants', { q: '', status: '', createdFrom: '', createdTo: '' });
useHead({ title: 'Tenants' });
</script>
<template>
  <div>
    <header class="admin-page-header">
      <div>
        <p class="eyebrow">
          Control plane / Businesses
        </p><h1>Tenants<span class="heading-dot">.</span></h1><p class="muted">
          Business accounts, lifecycle and platform configuration.
        </p>
      </div><button v-if="can('tenant.manage')" class="button button--primary" @click="showCreate = !showCreate">
        {{ showCreate ? 'Close form' : 'New tenant' }}
      </button>
    </header><section v-if="showCreate" class="admin-panel admin-inline-form">
      <h2>Create a tenant</h2><NewTenantForm @created="reload" />
    </section><section class="admin-panel">
      <form class="admin-filters" @submit.prevent="reload">
        <label class="field admin-search">Search<input v-model="filters.q" type="search" placeholder="Business name or slug"></label><label class="field">Status<select v-model="filters.status"><option value="">All tenants</option><option v-for="status in ['ACTIVE','SUSPENDED','ARCHIVED']" :key="status" :value="status">{{ status }}</option></select></label><label class="field">Created from<input v-model="filters.createdFrom" type="date"></label><label class="field">Created to<input v-model="filters.createdTo" type="date"></label><button class="button button--secondary" :disabled="pending">
          Search tenants
        </button>
      </form><AdminState :pending="pending" :error="error" :empty="!page?.items.length" @retry="reload">
        <div class="admin-table-scroll">
          <table>
            <thead><tr><th>Tenant</th><th>Status</th><th>Users</th><th>Vertical</th><th>Created</th><th>Actions</th></tr></thead><tbody>
              <tr v-for="tenant in page?.items" :key="tenant.id">
                <td>
                  <NuxtLink class="strong" :to="`/tenants/${tenant.id}`">
                    {{ tenant.name }}
                  </NuxtLink><span class="table-subline mono">{{ tenant.slug }}</span>
                </td><td><PlatformStatus :status="tenant.status" /></td><td>{{ tenant.activeUserCount }} active<span class="table-subline">{{ tenant.userCount }} memberships</span></td><td>{{ tenant.vertical.replaceAll('-', ' ') }}</td><td class="small">
                  {{ adminDate(tenant.createdAt) }}
                </td><td>
                  <NuxtLink class="link" :to="`/tenants/${tenant.id}`">
                    View &amp; manage →
                  </NuxtLink>
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
    </section>
  </div>
</template>
