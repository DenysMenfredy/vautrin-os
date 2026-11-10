<script setup lang="ts">
const route = useRoute();
const { session, logout } = usePlatformSession();
const open = ref(false);
const error = ref('');
const destinations = [
  { to: '/dashboard', label: 'Overview', number: '01' },
  { to: '/users', label: 'Users', number: '02' },
  { to: '/tenants', label: 'Tenants', number: '03' },
  { to: '/audit', label: 'Audit log', number: '04' },
];
async function signOut() {
  try {
    await logout();
  } catch (cause) {
    error.value = adminError(cause);
  }
}
watch(
  () => route.fullPath,
  () => {
    open.value = false;
  },
);
useHead({
  titleTemplate: (title) => (title ? `${title} · Vautrin Platform` : 'Vautrin Platform'),
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
});
</script>
<template>
  <NuxtPage v-if="route.path === '/login'" />
  <div v-else-if="session" class="admin-workspace">
    <aside class="admin-sidebar" :class="{'is-open': open}">
      <NuxtLink to="/dashboard" class="admin-brand">
        VAUTRIN<span>/</span>
      </NuxtLink>
      <p class="admin-context">
        Platform Admin <span>Internal</span>
      </p>
      <nav aria-label="Platform navigation">
        <NuxtLink v-for="item in destinations" :key="item.to" :to="item.to" :class="{'is-active': route.path.startsWith(item.to)}">
          <span class="mono">{{ item.number }}</span>{{ item.label }}
        </NuxtLink>
      </nav>
      <div class="admin-sidebar-footer">
        <span class="admin-status-dot" />Control plane<span class="mono">v0.4</span>
      </div>
    </aside>
    <button v-if="open" class="admin-backdrop" aria-label="Close navigation" @click="open = false" />
    <div class="admin-body">
      <header class="admin-topbar">
        <button class="button button--ghost admin-menu" :aria-expanded="open" @click="open = !open">
          Menu
        </button>
        <span class="muted">Vautrin <span class="breadcrumb-slash">/</span> <strong>Platform administration</strong></span>
        <div class="admin-identity">
          <span class="badge">{{ session.platformRole.replaceAll('_', ' ') }}</span><span>{{ session.user.name ?? session.user.email }}</span><button class="button button--ghost button--small" @click="signOut">
            Sign out
          </button>
        </div>
      </header>
      <main class="admin-main">
        <p v-if="error" class="notice notice--error" role="alert">
          {{ error }}
        </p><NuxtPage />
      </main>
      <footer class="admin-footer">
        <span>Vautrin OS · Internal operations</span><span>All management actions are audited.</span>
      </footer>
    </div>
  </div>
  <div v-else class="admin-boot" role="status">
    Opening the control plane…
  </div>
</template>
