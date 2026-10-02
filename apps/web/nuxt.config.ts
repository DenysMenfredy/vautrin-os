// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-09-19',

  // The dashboard is authenticated and has no SEO pages. A client-rendered
  // shell can be generated for GCS without prerendering tenant data or
  // requiring Nitro in production. Local/container builds still run Nitro
  // for the same-origin /api development proxy.
  ssr: false,

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
   * `public.apiBase` is relative on purpose — the browser talks to /api on
   * its own origin. Nitro proxies this locally; the production load balancer
   * routes /api/* directly to apps/api. Both preserve HttpOnly cookie scope.
   *
   * The Nitro build can override these with NUXT_* environment variables:
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

  /**
   * Security headers (SDD-09).
   *
   * Unlike the API, this process serves documents, so a CSP is meaningful
   * here. It is deliberately strict but not yet locked down to nonces:
   * Nuxt's hydration payload is an inline script, hence 'unsafe-inline'.
   * Tightening that to nonce-based CSP is worth doing before the dashboard
   * handles real customer data.
   *
   * `frame-ancestors 'none'` and nosniff are the two with immediate value —
   * clickjacking and content sniffing need no further configuration to matter.
   */
  nitro: {
    routeRules: {
      '/**': {
        headers: {
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
          'Content-Security-Policy': [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "font-src 'self'",
            "img-src 'self' data:",
            "connect-src 'self'",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
          ].join('; '),
        },
      },
    },
  },

  css: ['~/assets/css/main.css'],

  devtools: { enabled: true },
});
