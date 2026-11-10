<script setup lang="ts">
import type { PlatformAudit } from '@vautrin/contracts';

const route = useRoute();
const stringQuery = (name: string) =>
  typeof route.query[name] === 'string' ? String(route.query[name]) : '';
const { filters, page, pending, error, history, reload, next, previous } =
  useAdminList<PlatformAudit>('/audit', {
    action: '',
    actorUserId: '',
    tenantId: stringQuery('tenantId'),
    targetType: stringQuery('targetType'),
    targetId: stringQuery('targetId'),
    from: '',
    to: '',
  });
useHead({ title: 'Audit log' });
</script>
<template>
  <div>
    <header class="admin-page-header">
      <div>
        <p class="eyebrow">
          Control plane / Accountability
        </p><h1>Audit log<span class="heading-dot">.</span></h1><p class="muted">
          Append-only records of platform management actions. All times are UTC.
        </p>
      </div>
    </header><section class="admin-panel">
      <form class="admin-filters" @submit.prevent="reload">
        <label class="field admin-search">Action<input v-model="filters.action" placeholder="platform.user.disabled"></label><label class="field">Actor ID<input v-model="filters.actorUserId" placeholder="Optional UUID"></label><label class="field">Tenant ID<input v-model="filters.tenantId" placeholder="Optional UUID"></label><label class="field">Target type<select v-model="filters.targetType"><option value="">All types</option><option v-for="type in ['user','tenant','membership','invitation']" :key="type">{{ type }}</option></select></label><label class="field">Target ID<input v-model="filters.targetId" placeholder="Optional UUID"></label><label class="field">From<input v-model="filters.from" type="date"></label><label class="field">To<input v-model="filters.to" type="date"></label><button class="button button--secondary" :disabled="pending">
          Filter audit log
        </button>
      </form><AdminState
        :pending="pending"
        :error="error"
        :empty="!page?.items.length"
        empty-message="No management actions match these filters."
        @retry="reload"
      >
        <AdminAuditTable :items="page?.items ?? []" />
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
