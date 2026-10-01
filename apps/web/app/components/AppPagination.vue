<script setup lang="ts">
defineProps<{ hasNext: boolean; hasPrevious: boolean; loading?: boolean }>();
defineEmits<{ previous: []; next: [] }>();
</script>

<template>
  <nav class="pagination" aria-label="Pagination">
    <button class="button button--secondary" type="button" :disabled="!hasPrevious || loading" @click="$emit('previous')">
      Previous
    </button>
    <button class="button button--secondary" type="button" :disabled="!hasNext || loading" @click="$emit('next')">
      Next
    </button>
  </nav>
</template>
