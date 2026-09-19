# Infrastructure

Two compose files, for two different ways of working.

## Development — infrastructure only

```bash
docker compose -f infra/docker-compose.yml up -d   # or: pnpm infra:up
pnpm db:deploy
pnpm --filter @vautrin/api dev
```

PostgreSQL and Redis run in containers; the applications run on the host with
hot reload and a debugger attached. This is the default loop, and it is what
the integration tests expect — they connect to `localhost:5435`.

## Full stack — everything containerised

```bash
pnpm docker:build   # tags images with the commit SHA (SDD-12 §9)
pnpm docker:up
pnpm docker:logs
```

Runs PostgreSQL, Redis, the migration job, the API and the worker together.
Useful for checking an image behaves the same as the host process, and the
closest local approximation of a deployment.

`docker-compose.yml` **includes** `infra/docker-compose.yml`, so PostgreSQL
and Redis are defined once and both entry points agree on version, health
checks and role bootstrap.

## Images

| Image | Dockerfile | Role |
|---|---|---|
| `vautrin/api` | `apps/api/Dockerfile` | HTTP API |
| `vautrin/worker` | `apps/worker/Dockerfile` | Queue consumer |
| `vautrin/migrate` | `packages/database/Dockerfile` | One-shot `prisma migrate deploy` |

`apps/web` has no image yet — the application does not exist (VOS-003).

All three build **from the repository root**, because each compiles the
shared workspace packages into itself (SDD-12 §8):

```bash
docker build -f apps/api/Dockerfile -t vautrin/api:$(git rev-parse --short HEAD) .
```

## Why migrations are a separate image

SDD-12 §7: *"Application startup must not race multiple instances attempting
arbitrary schema changes."*

Running `migrate deploy` from an application entrypoint means every replica
attempts the same DDL on every rollout. Instead the `migrate` service runs to
completion first, and both applications declare:

```yaml
depends_on:
  migrate:
    condition: service_completed_successfully
```

If a migration fails, the job exits non-zero and the applications never start
against a half-migrated schema.

It is also the only container that connects as `vautrin_migrator`, the
schema-owning role. The applications connect as `vautrin_app`, which RLS
constrains (ADR-005).

## Build notes

**Debian, not Alpine.** Prisma ships one engine binary per libc; the client
generated here carries the glibc build. Alpine would need a musl binary
target and saves little once the engines dominate image size.

**OpenSSL is installed explicitly.** `node:*-slim` omits it, and without it
Prisma cannot detect the libssl version — it warns and guesses an ABI.

**`pnpm deploy --prod` produces the runtime tree.** Only production
dependencies, with workspace packages materialised as real directories. The
Prisma client is generated into `packages/database/generated/` so it ships as
an ordinary package file and needs no generate step at deploy time.

**Images run as the unprivileged `node` user** (SDD-09 §10).

## Health checks

`api` uses its own readiness endpoint, which verifies the database rather
than merely proving the process is alive.

`worker` pings Redis. Be clear on what that does *not* prove: the ping comes
from a separate process, so it cannot tell you the consumer loop is still
turning. A real liveness signal needs a heartbeat written by the processors
themselves (VOS-122).

## Ports

Host `5435` for PostgreSQL, not `5432` — local PostgreSQL installs commonly
occupy 5432 and 5433. Override with `POSTGRES_PORT`, `REDIS_PORT` and
`API_HOST_PORT`.
