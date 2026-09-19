<script setup lang="ts">
const { data: health, error, status, refresh } = await useApiHealth();

// `health.value !== null` is not enough: a failed fetch can leave it
// undefined, and `undefined !== null` is true — which rendered a dead
// API as reachable.
const apiReachable = computed(() => !error.value && Boolean(health.value));
const databaseUp = computed(() => health.value?.database.status === 'up');
</script>

<template>
  <section class="page">
    <h1 class="page__title">
      Platform status
    </h1>
    <p class="page__lead">
      Scaffold only. The revenue workflow — lead capture, AI reception,
      qualification, follow-up, booking, estimates — is not built yet.
    </p>

    <ul class="status">
      <li class="status__item">
        <span class="status__label">API</span>
        <span :class="['status__dot', apiReachable ? 'is-up' : 'is-down']" />
        <span class="status__value">{{ apiReachable ? 'reachable' : 'unreachable' }}</span>
      </li>

      <li class="status__item">
        <span class="status__label">Database</span>
        <span :class="['status__dot', databaseUp ? 'is-up' : 'is-down']" />
        <span class="status__value">
          {{ databaseUp ? `up · ${health?.database.latencyMs ?? 0}ms` : 'unavailable' }}
        </span>
      </li>
    </ul>

    <button class="refresh" :disabled="status === 'pending'" @click="refresh()">
      {{ status === 'pending' ? 'Checking…' : 'Re-check' }}
    </button>

    <p v-if="error" class="error">
      Could not reach the API. Is it running on
      <code>{{ useApiBase() }}</code>?
    </p>
  </section>
</template>
