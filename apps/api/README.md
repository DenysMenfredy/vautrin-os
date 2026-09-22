# @vautrin/api

The Vautrin OS HTTP API — a NestJS modular monolith (VOS-004, ADR-002).

## Run

```bash
docker compose -f infra/docker-compose.yml up -d
pnpm db:deploy
pnpm --filter @vautrin/api dev
```

| Route | Purpose |
|---|---|
| `GET /api/health/live` | Liveness — touches no dependency |
| `GET /api/health/ready` | Readiness — verifies the database |
| `POST /api/auth/login` | Authenticate and issue short-lived access and rotating refresh tokens |
| `POST /api/auth/refresh` | Rotate a refresh token from the HttpOnly cookie or request body |
| `POST /api/auth/logout` | Revoke the refresh token in the HttpOnly cookie |
| `GET /api/auth/me` | Return the authenticated user, active tenant, role and capabilities |
| `POST /api/auth/tenant` | Switch active tenant for a verified membership |
| `GET/PATCH /api/business/profile` | Read or create/update profile for the active tenant |
| `GET/POST /api/business/locations` | List (cursor-paginated) or create locations |
| `GET/PATCH/DELETE /api/business/locations/:id` | Read, update, or archive a location |
| `GET/POST /api/business/services` | List (cursor-paginated) or create catalog services |
| `GET/PATCH/DELETE /api/business/services/:id` | Read, update, or deactivate a service |
| `GET/POST /api/business/service-areas` | List (cursor-paginated) or create service areas |
| `GET/PATCH/DELETE /api/business/service-areas/:id` | Read, update, or deactivate a service area |
| `GET /api/docs` | OpenAPI UI (non-production only) |
| `GET /api/docs-json` | OpenAPI document (non-production only) |

## Structure

```text
src/
  main.ts                      bootstrap: prefix, validation, filters, OpenAPI
  app.module.ts                composition root
  config/environment.module.ts validated environment, global
  database/                    DatabaseService — tenant-scoped data access
  health/                      liveness + readiness
  common/                      cross-cutting HTTP concerns
```

`app.module.ts` wires the implemented Auth, Tenant, Audit, Health, and Database
modules. Business Configuration now provides profile, location, service, and
service-area APIs. Contact, Lead, Conversation, Appointment, Estimate,
Workflow, Agent, Knowledge, Integration, and Analytics HTTP features remain
future work.

## Authentication smoke tests

Open [`REST_COLLECTION`](./REST_COLLECTION) in Bruno and select its `Local API`
environment. Add an existing provisioned user's email and password in that
environment's local secret fields. If the user belongs to multiple tenants,
set `tenantId` to one of their membership IDs; otherwise the collection uses the
active tenant returned by login. The API has no public sign-up or demo-account
route.

Requests are ordered so **Run All** checks health and validation, then exercises
login, `/me`, tenant switching, body and cookie refresh, logout and refresh-token
revocation, and business-configuration smoke calls. API docs requests are for
non-production environments only. Bruno keeps access and refresh tokens as
runtime variables and rotates the refresh cookie between requests.

## Production cookie and proxy contract

The preferred topology is same-origin: the Nuxt application serves the browser
and proxies `/api/*` to this service. The refresh token is HttpOnly, scoped to
`/api/auth`, and Secure in production. Cookie-authenticated mutations validate
an exact `Origin` against `TRUSTED_ORIGINS`; requests without an Origin remain
available to non-browser clients. Do not configure a wildcard origin.

Set `TRUSTED_ORIGINS` to a comma-separated list such as
`https://app.example.com` and set `TRUST_PROXY` to the exact number of trusted
reverse-proxy hops. The API applies that proxy setting before using
`request.ip` for rate limits or audit context. Login and refresh use expiring
Redis counters keyed by IP plus normalized account/token identifiers; they do
not permanently lock accounts.

## Reaching the database

`DatabaseService.withTenant()` is the supported path:

```ts
const leads = await this.database.withTenant(tenantId, (tx) =>
  tx.lead.findMany({ where: { status: 'NEW' } }),
);
```

`.unscoped` exists for genuinely tenant-independent work — the readiness
probe, and the authentication lookup that must find a user before any tenant
is known. Tenant-scoped tables return zero rows through it, by design
(ADR-005).

Tenant context is never taken from client input. It is derived from
authenticated membership (SDD-05 §2); the resolver arrives with VOS-033.

Business configuration routes require an active-tenant access token.
`business.read` is required for reads and `business.manage` for mutations.
List endpoints use `limit` (default 50, maximum 100), optional `search`, and
the opaque `nextCursor` returned in each page. Service and service-area lists
also accept an `active` filter. Location deletion is an archive (`deleted_at`);
service and service-area deletion deactivates the record so configuration can
be restored without losing its history. The authenticated tenant claim—not a
body/query tenant ID—selects the RLS context.

## Conventions

**Validation.** A global `ValidationPipe` runs with `whitelist` and
`forbidNonWhitelisted`, so unknown properties are stripped and then rejected.
Endpoints take a DTO — that is what makes the rule enforceable.

**Errors.** `AllExceptionsFilter` gives every failure one shape. Unexpected
exceptions are logged in full and returned as a bare 500: stack traces and
driver errors are useless to a caller and useful to an attacker
(AGENTS.md §8).

**Shutdown.** Shutdown hooks are enabled so SIGTERM drains in-flight requests
and closes the database pool during a rolling deploy.

## Not here yet

Contact, Lead, Conversation, Appointment, Estimate, Workflow, Agent, Knowledge,
Integration, Analytics, business-hours, and structured JSON logging with
correlation IDs (VOS-120) remain future work. The API currently uses Nest's
default logger.
