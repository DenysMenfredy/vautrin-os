<script setup lang="ts">
import type {
  PlatformAuditPage,
  PlatformDashboard,
  PlatformMonthlyAnalytics,
} from '@vautrin/contracts';

const api = useAdminApi();
const { data, pending, error, refresh } = await useAsyncData('platform-dashboard', async () => {
  const [dashboard, users, tenants, audit] = await Promise.all([
    api<PlatformDashboard>('/dashboard'),
    api<PlatformMonthlyAnalytics>('/analytics/users-per-month', { query: { months: 12 } }),
    api<PlatformMonthlyAnalytics>('/analytics/tenants-per-month', { query: { months: 12 } }),
    api<PlatformAuditPage>('/audit', { query: { limit: 5 } }),
  ]);
  return { dashboard, users, tenants, audit };
});
const metrics = computed(() =>
  data.value
    ? [
        {
          label: 'Registered users',
          value: data.value.dashboard.summary.usersTotal,
          detail: `${data.value.dashboard.summary.usersCreatedThisMonth} created this month`,
        },
        {
          label: 'Active users',
          value: data.value.dashboard.summary.usersActive,
          detail: `${data.value.dashboard.summary.usersDisabled} disabled · ${data.value.dashboard.summary.usersDeleted} deleted`,
        },
        {
          label: 'Total tenants',
          value: data.value.dashboard.summary.tenantsTotal,
          detail: `${data.value.dashboard.summary.tenantsCreatedThisMonth} created this month`,
        },
        {
          label: 'Active tenants',
          value: data.value.dashboard.summary.tenantsActive,
          detail: `${data.value.dashboard.summary.pendingInvitations} pending invitations`,
        },
      ]
    : [],
);
useHead({ title: 'Platform overview' });
</script>
<template>
  <div>
    <header class="admin-page-header">
      <div>
        <p class="eyebrow">
          Control plane / Overview
        </p><h1>Platform overview<span class="heading-dot">.</span></h1><p class="muted">
          Identity, businesses and platform activity at a glance.
        </p>
      </div><button class="button button--secondary" :disabled="pending" @click="refresh()">
        Refresh overview
      </button>
    </header><AdminState :pending="pending" :error="error ? adminError(error) : ''" @retry="refresh()">
      <template v-if="data">
        <div class="admin-metrics">
          <article v-for="metric in metrics" :key="metric.label" class="admin-metric">
            <span class="small muted">{{ metric.label }}</span><strong>{{ metric.value.toLocaleString() }}</strong><span class="small muted">{{ metric.detail }}</span>
          </article>
        </div><div class="admin-chart-grid">
          <RegistrationChart title="User registrations" :series="data.users.series" /><RegistrationChart title="Tenant registrations" :series="data.tenants.series" />
        </div><section class="admin-panel">
          <div class="admin-panel-heading">
            <div>
              <h2>Recent platform activity</h2><p class="small muted">
                A durable record of management actions.
              </p>
            </div><NuxtLink class="link small" to="/audit">
              View audit log →
            </NuxtLink>
          </div><AdminAuditTable v-if="data.audit.items.length" :items="data.audit.items" /><div v-else class="admin-state">
            No platform activity yet.
          </div>
        </section><p class="small muted admin-updated">
          Updated {{ adminDate(data.dashboard.generatedAt) }} · Reporting timezone: UTC
        </p>
      </template>
    </AdminState>
  </div>
</template>
