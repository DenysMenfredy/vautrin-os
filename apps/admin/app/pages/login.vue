<script setup lang="ts">
const { login } = usePlatformSession();
const email = ref('');
const password = ref('');
const busy = ref(false);
const error = ref('');
async function submit() {
  busy.value = true;
  error.value = '';
  try {
    await login(email.value, password.value);
    password.value = '';
    await navigateTo('/dashboard');
  } catch (cause) {
    error.value = adminError(cause);
  } finally {
    busy.value = false;
  }
}
useHead({ title: 'Platform sign in' });
</script>
<template>
  <main class="admin-login">
    <div class="admin-login-brand">
      <span class="admin-brand">VAUTRIN<span>/</span></span><span class="admin-context">Platform Admin</span>
    </div>
    <section class="admin-login-form">
      <p class="eyebrow">
        Internal operations
      </p><h1>Platform access.</h1><p class="muted">
        Sign in with your authorized Vautrin operator account.
      </p>
      <form class="form-stack" @submit.prevent="submit">
        <div class="field">
          <label for="admin-email">Email address</label><input
            id="admin-email"
            v-model="email"
            type="email"
            autocomplete="username"
            required
          >
        </div>
        <div class="field">
          <label for="admin-password">Password</label><input
            id="admin-password"
            v-model="password"
            type="password"
            autocomplete="current-password"
            maxlength="256"
            required
          >
        </div>
        <p v-if="error" class="notice notice--error" role="alert">
          {{ error }}
        </p><button class="button button--primary" :disabled="busy">
          {{ busy ? 'Signing in…' : 'Sign in' }}
        </button>
      </form><p class="small muted admin-login-note">
        Access is restricted to authorized platform operators. A business OWNER or ADMIN role does not grant platform access.
      </p>
    </section><footer class="small muted">
      Vautrin OS · Platform control plane
    </footer>
  </main>
</template>
