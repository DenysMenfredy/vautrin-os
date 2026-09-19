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
| `GET /api/docs` | OpenAPI UI (non-production only) |

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

`app.module.ts` gains the SDD-02 §4 modules (Auth, Tenant, Business, Contact,
Lead, Conversation, Appointment, Estimate, Workflow, Agent, Knowledge,
Integration, Analytics, Audit) as their backlog items land. Only
infrastructure is wired today.

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

Structured JSON logging with correlation IDs (VOS-120), authentication
(VOS-030), tenant resolution (VOS-033), RBAC (VOS-034), and the Dockerfile
(VOS-023). The API currently uses Nest's default logger.
