import { fileURLToPath } from 'node:url';
export default defineNuxtConfig({
  compatibilityDate: '2026-11-10',
  ssr: false,
  typescript: { strict: true, typeCheck: false },
  devServer: { port: 8081 },
  runtimeConfig: {
    apiInternalBase: 'http://localhost:1447/api/admin',
    public: { apiBase: '/api/admin', applicationBaseUrl: 'http://localhost:8080' },
  },
  css: ['~/assets/admin.css'],
  nitro: {
    publicAssets: [
      { dir: fileURLToPath(new URL('../web/public/fonts', import.meta.url)), baseURL: '/fonts' },
    ],
    prerender: {
      routes: ['/', '/login', '/dashboard', '/users', '/tenants', '/audit'],
      crawlLinks: false,
    },
    routeRules: {
      '/**': {
        headers: {
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'no-referrer',
          'Cache-Control': 'no-store',
          'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
          'Content-Security-Policy':
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
        },
      },
    },
  },
  devtools: { enabled: false },
});
