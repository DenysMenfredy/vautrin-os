# @vautrin/web

The Vautrin OS operations workspace — Nuxt 4 + Vue 3 + TypeScript.

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
  app.vue                 authenticated shell and tenant switcher
  pages/                 overview, leads, inbox, appointments, workflows,
                         AI Workforce, settings and authentication
  components/            shared UI primitives
  composables/            same-origin API and in-memory access session
  assets/css/main.css     design-system tokens and responsive components
public/fonts/            local Geist and Geist Mono (SIL OFL 1.1)
server/
  api/[...path].ts        local/container-only same-origin proxy to apps/api
nuxt.config.ts
```

## How it talks to the API

The browser calls `/api/...` **on the same origin**. In local/Compose
development Nitro proxies onward; in the static GCS deployment the external
HTTPS load balancer routes `/api/*` to `apps/api`. The browser never calls a
separate API origin. That avoids three things at once:

- CORS configuration on every API deployment;
- the API needing to be publicly reachable rather than only reachable by the
  frontend;
- cross-site cookie handling (`SameSite=None`, credentials) for refresh
  sessions (VOS-030).

The Docker/Nitro build uses these runtime values. The static build embeds the
public `/api` path at build time and does not use `apiInternalBase`:

| Config | Env var | Meaning |
|---|---|---|
| `apiInternalBase` | `NUXT_API_INTERNAL_BASE` | Where Nitro proxies. Server-only; never reaches the browser. |
| `public.apiBase` | `NUXT_PUBLIC_API_BASE` | What the browser calls. Relative (`/api`). |

In Compose, `apiInternalBase` is `http://api:3000/api` — a private address
the browser could never resolve, which is exactly why it stays server-side.

## Static production artifact

Run `pnpm --filter @vautrin/web build:static` and upload only
`apps/web/.output/public/` to GCS. The verification script checks the
client-only shell, fallback pages, known deep routes, and same-origin API
configuration. It does not require a running Nuxt server or bake in an API
origin. The existing `build`/`start` commands and Dockerfile are for local or
container-based deployment; they are not the GCS release artifact.

The external HTTPS load balancer must send `/api/*` to the API backend and
static requests to the GCS backend bucket. Configure the URL map to serve
`index.html` for `/` and each generated `/<route>/index.html` for direct
navigation to `/<route>`; verify deep links through the actual load balancer.
Do not assume GCS website `MainPageSuffix` or `NotFoundPage` applies to backend
bucket requests. If dynamic frontend routes are added, configure a scoped SPA
fallback using `200.html`, without rewriting `/api/*` or missing asset paths.
The GCP deployment must set security headers on the load balancer/backend:
Nitro `routeRules` headers do not accompany static files. Cache hashed
`_nuxt/` assets immutably but keep HTML shells and `200.html` short-lived.
Smoke-test login, refresh, logout, and direct deep-link navigation through
the real HTTPS origin before calling staging ready.

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

## Current UI scope

The workspace follows `Vautrin_OS_Design_System_v1.0.pdf` and reads the active
tenant from `/auth/me`. The access token stays in memory. The browser relies on
the HttpOnly refresh cookie, and only the API may approve tenant switching.

The overview uses `/crm/dashboard` for stage counts. Leads, conversations,
appointments, workflows, agents and business settings use their existing API
endpoints. Workflow drafts have a linear editor for the worker's implemented
wait, condition, literal SMS and end actions. Agent drafts can be versioned,
but the worker does not execute agents yet. The API does not yet expose
estimates, lead next actions, joined assignee names, workflow run statistics
or AI message authorship. These are
shown as unavailable or omitted rather than represented by invented data.
