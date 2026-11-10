<script setup lang="ts">
import type { PlatformTenantPage } from '@vautrin/contracts';

defineProps<{ modelValue: string; required?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const api = useAdminApi();
const query = ref('');
const tenants = ref<PlatformTenantPage['items']>([]);
const error = ref('');
async function search() {
  try {
    tenants.value = (
      await api<PlatformTenantPage>('/tenants', {
        query: { q: query.value, status: 'ACTIVE', limit: 25 },
      })
    ).items;
    error.value = '';
  } catch (cause) {
    error.value = adminError(cause);
  }
}
onMounted(search);
</script>
<template>
  <div class="field">
    <label>Find an active tenant<input v-model="query" type="search" placeholder="Search by business name or slug" @keydown.enter.prevent="search"></label><button class="button button--secondary button--small tenant-search-button" type="button" @click="search">
      Find tenants
    </button><label>Tenant<select :value="modelValue" :required="required" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"><option value="">Choose a tenant</option><option v-for="tenant in tenants" :key="tenant.id" :value="tenant.id">{{ tenant.name }} · {{ tenant.slug }}</option></select></label><p v-if="error" class="inline-error" role="alert">
      {{ error }}
    </p>
  </div>
</template>
