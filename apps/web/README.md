# @vautrin/web

The Vautrin OS dashboard — Nuxt 4 + Vue 3 + TypeScript (VOS-003).

## Run

```bash
docker compose -f infra/docker-compose.yml up -d
pnpm --filter @vautrin/api dev     # port 3000
pnpm --filter @vautrin/web dev     # port 3002
```

Port 3002, not 3001: 3000 belongs to the API and 3001 is commonly taken by
other local services.

## Structure

Nuxt 4's layout — application code lives in `app/`, server code at the root:

```text
app/
  app.vue                 root shell
  pages/index.vue         platform status
  composables/            useApiBase, useApiHealth
  assets/css/main.css     baseline styling only
server/
  api/[...path].ts        same-origin proxy to apps/api
nuxt.config.ts
```

## How it talks to the API

The browser calls `/api/...` **on the Nuxt origin**, and Nitro proxies onward.
It does not call the API host directly. That avoids three things at once:

- CORS configuration on every API deployment;
- the API needing to be publicly reachable rather than only reachable by the
  frontend;
- cross-site cookie handling (`SameSite=None`, credentials) for refresh
  sessions (VOS-030).

Two runtime values, both overridable through `NUXT_*` env vars so one built
image works across environments (SDD-12 §9):

| Config | Env var | Meaning |
|---|---|---|
| `apiInternalBase` | `NUXT_API_INTERNAL_BASE` | Where Nitro proxies. Server-only; never reaches the browser. |
| `public.apiBase` | `NUXT_PUBLIC_API_BASE` | What the browser calls. Relative (`/api`). |

In compose, `apiInternalBase` is `http://api:3000/api` — a private address
the browser could never resolve, which is exactly why it stays server-side.

## Types come from @vautrin/contracts

Response shapes are imported, never redeclared:

```ts
import type { ReadinessResponse } from '@vautrin/contracts';
```

SDD-02 §6 — "Frontend must not depend on backend internal domain entities",
but shared response DTOs are explicitly allowed. The API's DTO classes
`implements` the same interfaces, so a change to a response shape fails to
compile on the server rather than silently breaking this app.

## Linting

Two tools, split by what each can see:

- **Biome** — `<script>` blocks and every `.ts` file
- **ESLint + eslint-plugin-vue** — `<template>` blocks only

Biome does not parse templates, so it cannot check `v-for` keys or template
formatting; ESLint covers that gap. Two Biome rules are disabled for `.vue`
because they produce false positives on correct Vue code —
`noUnusedVariables`/`noUnusedImports` (template-only bindings look unused)
and `useVueMultiWordComponentNames` (Nuxt derives names from file paths).
See the comments in `biome.jsonc`.

## Tests

This app is the one deliberate exception to the shared `@vautrin/testing`
presets: it uses `defineVitestConfig` from `@nuxt/test-utils`, which provides
auto-imports, runtime config and a DOM. The file-naming convention is
unchanged.

Two gotchas worth knowing before adding tests:

- `registerEndpoint` does **not** override an earlier registration for the
  same path. Register once and switch behaviour with a flag.
- `useFetch` caches by `key`, so a second mount reuses the first response
  unless you `clearNuxtData(key)` first.

## Not here yet

The web app still has only the status page: it has no login/session UI, layouts,
design system, CRM views (VOS-055), or inbox (VOS-065). API authentication is
implemented (VOS-030). The page exists to prove the web → API → database path
works end to end.
