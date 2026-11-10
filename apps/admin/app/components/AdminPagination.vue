<script setup lang="ts">
defineProps<{ nextCursor: string | null; hasPrevious: boolean; pending: boolean; count: number }>();
defineEmits<{ next: []; previous: [] }>();
</script>
<template>
  <div class="admin-pagination">
    <span class="small muted">{{ count }} results · up to 25 per page</span><div class="form-actions">
      <button class="button button--secondary button--small" :disabled="!hasPrevious || pending" @click="$emit('previous')">
        Previous
      </button><button class="button button--secondary button--small" :disabled="!nextCursor || pending" @click="$emit('next')">
        Next
      </button>
    </div>
  </div>
</template>
