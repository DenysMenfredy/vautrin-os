<script setup lang="ts">
const route = useRoute();
const token = ref(typeof route.query.token === 'string' ? route.query.token : '');
const name = ref('');
const password = ref('');
const busy = ref(false);
const accepted = ref(false);
const error = ref('');

async function accept() {
  error.value = '';
  busy.value = true;
  try {
    await $fetch(`${useApiBase()}/auth/invitations/accept`, {
      method: 'POST',
      body: {
        token: token.value.trim(),
        password: password.value,
        ...(name.value.trim() ? { name: name.value.trim() } : {}),
      },
      credentials: 'same-origin',
    });
    accepted.value = true;
    // Invitation tokens must not remain in browser history after acceptance.
    await navigateTo('/invitation', { replace: true });
  } catch (cause) {
    error.value = apiErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
useHead({ title: 'Accept invitation' });
</script>

<template>
  <main class="auth-page">
    <div class="auth-page__brand">
      <span class="brand-wordmark">VAUTRIN<span class="brand-mark">/</span></span><span>OS</span>
    </div>
    <div class="auth-panel">
      <p class="eyebrow">
        Business invitation
      </p>
      <template v-if="accepted">
        <h1>Your account is ready.</h1><p class="muted">
          Sign in with your email and password to enter the workspace.
        </p><NuxtLink class="button button--primary" to="/login">
          Sign in
        </NuxtLink>
      </template>
      <template v-else>
        <h1>Join your business.</h1><p class="muted">
          Use the invitation sent by your administrator. Existing users should enter their current password.
        </p>
        <form class="form-stack" @submit.prevent="accept">
          <div class="field">
            <label for="invite-token">Invitation token</label><input
              id="invite-token"
              v-model="token"
              type="text"
              autocomplete="off"
              required
            >
          </div>
          <div class="field">
            <label for="invite-name">Name <span class="muted">(new accounts)</span></label><input id="invite-name" v-model="name" type="text" autocomplete="name">
          </div>
          <div class="field">
            <label for="invite-password">Password</label><input
              id="invite-password"
              v-model="password"
              type="password"
              autocomplete="current-password"
              required
              minlength="12"
            >
          </div>
          <p v-if="error" class="inline-error" role="alert">
            {{ error }}
          </p>
          <button class="button button--primary" type="submit" :disabled="busy">
            {{ busy ? 'Accepting…' : 'Accept invitation' }}
          </button>
        </form>
      </template>
    </div>
  </main>
</template>
