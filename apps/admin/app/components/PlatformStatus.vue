<script setup lang="ts">
const props = defineProps<{ status: string }>();
const tone = computed(() =>
  ['ACTIVE'].includes(props.status)
    ? 'success'
    : ['DISABLED', 'SUSPENDED', 'REVOKED', 'DELETED', 'ARCHIVED'].includes(props.status)
      ? 'danger'
      : 'warning',
);
</script>
<template><span class="badge" :class="`badge--${tone}`"><span class="status-dot" />{{ status.replaceAll('_', ' ') }}</span></template>
