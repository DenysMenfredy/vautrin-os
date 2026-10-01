<script setup lang="ts">
defineProps<{ title: string; detail?: string }>();
</script>

<template>
  <div class="empty-state">
    <p class="empty-state__title">
      {{ title }}
    </p>
    <p v-if="detail" class="muted">
      {{ detail }}
    </p>
    <slot />
  </div>
</template>
