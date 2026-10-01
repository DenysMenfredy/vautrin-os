<script setup lang="ts">
const { login } = useSession();
const email = ref('');
const password = ref('');
const busy = ref(false);
const error = ref('');

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    await login(email.value.trim(), password.value);
    await navigateTo('/');
  } catch (cause) {
    error.value = apiErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
useHead({ title: 'Sign in' });
</script>

<template>
  <main class="auth-page">
    <div class="auth-page__brand">
      <span class="brand-wordmark">VAUTRIN<span class="brand-mark">/</span></span><span>OS</span>
    </div>
    <div class="auth-panel">
      <p class="eyebrow">
        Revenue &amp; operations workspace
      </p>
      <h1>Welcome back.</h1>
      <p class="muted">
        Sign in to work with your business.
      </p>
      <form class="form-stack" @submit.prevent="submit">
        <div class="field">
          <label for="email">Email</label><input
            id="email"
            v-model="email"
            type="email"
            autocomplete="email"
            required
          >
        </div>
        <div class="field">
          <label for="password">Password</label><input
            id="password"
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
          >
        </div>
        <p v-if="error" class="inline-error" role="alert">
          {{ error }}
        </p>
        <button class="button button--primary" type="submit" :disabled="busy">
          {{ busy ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
      <p class="auth-panel__foot">
        New to Vautrin? Ask your business administrator for an invitation.
      </p>
    </div>
  </main>
</template>
