<script setup lang="ts">
defineProps<{ pending?: boolean; error?: string; empty?: boolean; emptyMessage?: string }>();
defineEmits<{ retry: [] }>();
</script>
<template>
  <div v-if="pending" class="admin-state" role="status">
    <span class="admin-pulse" />Loading platform data…
  </div><div v-else-if="error" class="admin-state" role="alert">
    <strong>We couldn’t load this view.</strong><p>{{ error }}</p><button class="button button--secondary" @click="$emit('retry')">
      Try again
    </button>
  </div><div v-else-if="empty" class="admin-state">
    <strong>No results.</strong><p class="muted">
      {{ emptyMessage ?? 'Try adjusting your search or filters.' }}
    </p>
  </div><slot v-else />
</template>
