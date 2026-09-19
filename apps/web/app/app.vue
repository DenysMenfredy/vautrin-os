<script setup lang="ts">
useHead({
  title: 'Vautrin OS',
  meta: [{ name: 'description', content: 'Revenue workflow platform for local businesses' }],
});
</script>

<template>
  <div class="app">
    <header class="app__header">
      <span class="app__mark">Vautrin OS</span>
      <span class="app__env">v0.1</span>
    </header>

    <main class="app__main">
      <NuxtPage />
    </main>
  </div>
</template>
