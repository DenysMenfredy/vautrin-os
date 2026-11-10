export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server || to.path === '/login') return;
  const { session, restore } = usePlatformSession();
  if (!session.value && !(await restore())) return navigateTo('/login');
});
