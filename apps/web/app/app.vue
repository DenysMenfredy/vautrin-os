<script setup lang="ts">
const route = useRoute();
const { session, ready, restore, switchTenant, logout, can } = useSession();
const mobileNavOpen = ref(false);
const switching = ref(false);
const sessionError = ref('');
const search = ref('');
const authRoute = computed(() => route.path === '/login' || route.path === '/invitation');
const activeTenant = computed(() =>
  session.value?.memberships.find(
    (membership) => membership.tenantId === session.value?.activeTenantId,
  ),
);
const destinations = [
  { label: 'Overview', to: '/', capability: 'lead.read' },
  { label: 'Leads', to: '/leads', capability: 'lead.read' },
  { label: 'Conversations', to: '/conversations', capability: 'conversation.read' },
  { label: 'Appointments', to: '/appointments', capability: 'appointment.read' },
  { label: 'Workflows', to: '/workflows', capability: 'workflow.read' },
  { label: 'AI Workforce', to: '/agents', capability: 'business.read' },
  { label: 'Settings', to: '/settings', capability: 'business.read' },
];
const visibleDestinations = computed(() => destinations.filter((item) => can(item.capability)));

onMounted(async () => {
  if (!(await restore()) && !authRoute.value) await navigateTo('/login');
});

watch(
  () => route.fullPath,
  () => {
    mobileNavOpen.value = false;
  },
);

async function changeTenant(event: Event) {
  const target = event.target as HTMLSelectElement;
  if (!target.value || target.value === session.value?.activeTenantId) return;
  switching.value = true;
  sessionError.value = '';
  try {
    await switchTenant(target.value);
    await navigateTo('/');
    // Keying the workspace remounts all tenant data after the server confirms
    // membership and issues a new tenant-scoped access token.
  } catch (cause) {
    sessionError.value = apiErrorMessage(cause);
  } finally {
    switching.value = false;
  }
}

async function signOut() {
  sessionError.value = '';
  try {
    await logout();
    await navigateTo('/login');
  } catch (cause) {
    sessionError.value = `Sign out failed. ${apiErrorMessage(cause)}`;
  }
}

async function submitSearch() {
  if (!search.value.trim()) return;
  await navigateTo({ path: '/leads', query: { search: search.value.trim() } });
}

useHead({ titleTemplate: (title) => (title ? `${title} · Vautrin OS` : 'Vautrin OS') });
</script>

<template>
  <div v-if="authRoute" class="auth-layout">
    <NuxtPage />
  </div>
  <div v-else-if="!ready || switching" class="boot-state" role="status" aria-live="polite">
    <span class="brand-wordmark">VAUTRIN</span><p>Opening your workspace…</p>
  </div>
  <div v-else-if="session" :key="session.activeTenantId ?? 'no-tenant'" class="workspace">
    <aside class="sidebar" :class="{ 'sidebar--open': mobileNavOpen }" aria-label="Main navigation">
      <div class="sidebar__brand">
        <NuxtLink to="/" class="brand-wordmark" @click="mobileNavOpen = false">
          VAUTRIN<span class="brand-mark">/</span>
        </NuxtLink>
        <span class="sidebar__context">OS <span>/</span> {{ activeTenant?.name ?? 'Select a business' }}</span>
      </div>
      <nav class="sidebar__nav">
        <NuxtLink
          v-for="item in visibleDestinations"
          :key="item.to"
          :to="item.to"
          class="sidebar__link"
          :class="{ 'sidebar__link--active': item.to === '/' ? route.path === '/' : route.path.startsWith(item.to) }"
          @click="mobileNavOpen = false"
        >
          {{ item.label }}
        </NuxtLink>
      </nav>
      <div class="sidebar__footer">
        <span>Revenue &amp; operations</span><span>Vautrin OS</span>
        <button class="button button--ghost sidebar-signout" type="button" @click="signOut">
          Sign out
        </button>
      </div>
    </aside>
    <button
      v-if="mobileNavOpen"
      class="drawer-backdrop"
      type="button"
      aria-label="Close menu"
      @click="mobileNavOpen = false"
    />
    <div class="workspace__body">
      <header class="utility-bar">
        <button
          class="menu-toggle button button--ghost"
          type="button"
          :aria-expanded="mobileNavOpen"
          :aria-label="mobileNavOpen ? 'Close menu' : 'Open menu'"
          @click="mobileNavOpen = !mobileNavOpen"
        >
          <AppIcon name="menu" />
        </button>
        <form class="utility-search" role="search" @submit.prevent="submitSearch">
          <label class="sr-only" for="global-search">Search leads</label>
          <AppIcon name="search" /><input id="global-search" v-model="search" type="search" placeholder="Search leads"><kbd>/</kbd>
        </form>
        <div class="utility-bar__right">
          <label class="sr-only" for="tenant-switcher">Active business</label>
          <select
            id="tenant-switcher"
            class="tenant-select"
            :value="session.activeTenantId ?? ''"
            :disabled="switching || session.memberships.length < 2"
            @change="changeTenant"
          >
            <option v-if="!session.activeTenantId" value="">
              Select business
            </option>
            <option v-for="membership in session.memberships" :key="membership.tenantId" :value="membership.tenantId">
              {{ membership.name }}
            </option>
          </select>
          <span class="utility-avatar" aria-hidden="true">{{ (session.user.name ?? session.user.email).slice(0, 1).toUpperCase() }}</span>
          <button class="button button--ghost signout" type="button" @click="signOut">
            Sign out
          </button>
        </div>
      </header>
      <p v-if="sessionError" class="notice notice--error session-error" role="alert">
        {{ sessionError }}
      </p>
      <main id="main-content" class="main-content">
        <div v-if="!session.activeTenantId" class="surface tenant-prompt">
          <p class="eyebrow">
            Business context
          </p>
          <h1>Select a business.</h1>
          <p class="muted">
            Choose a business you belong to before opening customer data.
          </p>
          <label class="sr-only" for="tenant-prompt-select">Business</label>
          <select id="tenant-prompt-select" class="control" @change="changeTenant">
            <option value="">
              Choose a business
            </option>
            <option v-for="membership in session.memberships" :key="membership.tenantId" :value="membership.tenantId">
              {{ membership.name }}
            </option>
          </select>
        </div>
        <NuxtPage v-else />
      </main>
    </div>
  </div>
</template>
