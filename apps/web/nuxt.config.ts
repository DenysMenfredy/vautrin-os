// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-09-19',

  // AGENTS.md §11 — TypeScript strict mode. `typeCheck` is left off the dev
  // server on purpose: `pnpm typecheck` runs vue-tsc in CI, and type checking
  // on every HMR update makes the dev loop noticeably slower.
  typescript: {
    strict: true,
    typeCheck: false,
  },

  /**
   * `apiInternalBase` is where Nitro proxies API calls (server/api). It is
   * server-only, so the API's real location never reaches the browser, and
   * it can point at a private address such as http://api:3000/api inside a
   * container network.
   *
   * `public.apiBase` is relative on purpose — the browser talks to the Nuxt
   * origin, which proxies onward. Same-origin means no CORS and no
   * cross-site cookie handling once auth lands.
   *
   * Both are overridable at runtime through NUXT_* environment variables,
   * so one built image works across environments (SDD-12 §9):
   *   NUXT_API_INTERNAL_BASE, NUXT_PUBLIC_API_BASE
   */
  runtimeConfig: {
    apiInternalBase: 'http://localhost:3000/api',
    public: {
      apiBase: '/api',
    },
  },

  // 3000 is apps/api; 3001 is commonly occupied on developer machines.
  devServer: { port: 3002 },

  css: ['~/assets/css/main.css'],

  devtools: { enabled: true },
});
