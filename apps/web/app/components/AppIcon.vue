<script setup lang="ts">
defineProps<{ name: 'menu' | 'search' | 'close' | 'back' }>();
</script>

<template>
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'menu'"><path d="M4 7h16M4 12h16M4 17h16" /></template>
    <template v-else-if="name === 'search'"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.2 4.2" /></template>
    <template v-else-if="name === 'close'"><path d="M5 5l14 14M19 5 5 19" /></template>
    <template v-else><path d="m11 5-7 7 7 7M4 12h16" /></template>
  </svg>
</template>
