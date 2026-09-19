# @vautrin/database

The Vautrin OS data layer (VOS-011): Prisma schema, migrations, and the
tenant-scoped client.

Specifications this package implements: **SDD-03** (domain model), **SDD-04**
(database), **SDD-05** (multi-tenancy), **ADR-003**, **ADR-004**, **ADR-005**.

## Layout

```text
prisma/
  schema.prisma                  26 models — exactly the table list in SDD-04 §3
  migrations/
    …000100_extensions_and_helpers   pgvector, uuidv7(), app.current_tenant_id()
    …000200_init                     tables, enums, indexes, foreign keys
    …000300_tenant_isolation_rls     RLS policies, runtime grants, drift guard
    …000400_knowledge_vector_index   HNSW index for semantic retrieval
src/
  client.ts          client factories + startup assertions
  tenant-context.ts  withTenant() — the only supported path to tenant data
  vector.ts          pgvector read/write (Prisma cannot map `vector`)
  config.ts          environment-derived configuration
  errors.ts          typed failures
test/
  unit.test.ts                       no database required
  tenant-isolation.integration.test.ts   SDD-05 §6 / SDD-11 §4
```

## Getting started

```bash
docker compose -f infra/docker-compose.yml up -d   # postgres + redis
cp .env.example .env                               # from the repo root
pnpm db:deploy                                     # apply migrations
pnpm --filter @vautrin/database test:integration   # prove isolation works
```

## The two database roles

RLS only protects anything when the runtime role is neither the table owner
nor `BYPASSRLS`. The roles are therefore split:

| Role | Connection string | Used by | Subject to RLS |
|---|---|---|---|
| `vautrin_app` | `DATABASE_URL` | `apps/api`, `apps/worker` | **yes** |
| `vautrin_migrator` | `DATABASE_MIGRATION_URL` | `prisma migrate`, tenant provisioning | no (owns the schema) |

`createPrismaClient()` returns the first. `createPlatformClient()` returns the
second and must never be handed to request-scoped code — it is for
provisioning a tenant, the tenant-deletion lifecycle (SDD-05 §8), and
maintenance.

Local role provisioning lives in `infra/postgres/initdb/01-roles.sql`. In
production these roles come from infrastructure, not from a migration.

## Reading and writing tenant data

Every tenant-scoped query goes through `withTenant`:

```ts
import { createPrismaClient, withTenant } from '@vautrin/database';

const prisma = createPrismaClient();

const newLeads = await withTenant(prisma, tenantId, (tx) =>
  tx.lead.findMany({ where: { status: 'NEW' }, take: 50 }),
);
```

`withTenant` opens a transaction and sets `app.tenant_id` **transaction-locally**
via `set_config(..., is_local => true)`. That detail matters: a session-level
`SET` would stay attached to a pooled connection and follow it to the next
borrower — the failure mode SDD-05 §4 calls out. The tenant id is bound as a
parameter, never interpolated.

Querying without it returns **zero rows**, not every row:

```ts
await prisma.lead.findMany();  // []  — app.current_tenant_id() is NULL
```

Failing closed is deliberate. The tradeoff is that a forgotten `withTenant`
looks like "no data" rather than an error, so repositories should take a
`TenantScopedClient` rather than a `PrismaClient` and make the requirement
visible in their signature.

### Background jobs

A worker has no ambient request, so the tenant travels in the payload
(SDD-05 §5) and is validated on arrival:

```ts
assertTenantJobContext(job.data);
await withTenant(prisma, job.data.tenantId, (tx) => handle(tx, job.data));
```

## Semantic retrieval

`knowledge_chunks.embedding` is a pgvector column. Prisma has no mapping for
it, so the model declares it `Unsupported("vector(1536)")` and all access goes
through `src/vector.ts`:

```ts
await withTenant(prisma, tenantId, (tx) =>
  searchKnowledgeChunks(tx, { tenantId, embedding, limit: 8 }),
);
```

Dimensions are provider/model configuration (SDD-04 §2), read from
`EMBEDDING_DIMENSIONS`. Because that constant and the `vector(N)` column can
drift apart, applications call `assertEmbeddingDimensions(client)` at startup
and fail fast instead of erroring deep inside the embedding pipeline.

Changing dimensions means a migration **and** re-embedding every chunk.

Retrieval is for unstructured knowledge only. Appointment availability, lead
status, and customer identity come from relational queries — SDD-06 §6.

## Migrations

```bash
pnpm --filter @vautrin/database migrate:dev      # author (creates + applies)
pnpm --filter @vautrin/database migrate:deploy   # apply (staging/production)
pnpm --filter @vautrin/database migrate:status
```

`prisma db push` is never used (SDD-04 §10, AGENTS.md §4).

Raw SQL — extensions, functions, RLS, vector indexes — lives in migration
files rather than being applied out of band. Prisma replays the full history
into its shadow database, so anything applied outside that history shows up as
schema drift.

### Adding a tenant-scoped table

1. Add the model with a `tenantId` field and a `@@index([tenantId, …])`.
2. Generate the migration.
3. Add the table to `tenant_scoped_tables` in a new RLS migration.
4. Extend the isolation tests.

Skipping step 3 is caught, not silently shipped: the RLS migration ends with a
check that fails if any table carrying `tenant_id` lacks `ENABLE` + `FORCE`
row level security.

## Conventions

- **IDs** are UUIDv7 via the `uuidv7()` SQL function (SDD-04 §5). Time-ordered,
  so inserts stay at the right edge of the primary-key btree instead of
  scattering across it. PostgreSQL 18 has a native `uuidv7()`; the `public`
  definition can be dropped on upgrade.
- **Timestamps** are `timestamptz(6)`.
- **Indexes** on tenant-scoped tables lead with `tenant_id` (SDD-04 §6). The
  set here is a starting point and still has to be validated against real
  query plans.
- **JSONB** is for genuinely flexible configuration — workflow definitions,
  provider metadata, tenant settings — not for avoiding a model (SDD-04 §7).
- **Secrets** are never stored. `integrations.credentials_ref` points at the
  secret manager (SDD-08 §4, SDD-09 §7).
- **Soft deletes** (`deleted_at`) exist on customer-facing records; the query
  layer is responsible for filtering them.

## Known exception: `users`

`users` is the one table with no RLS policy. It is a global identity
(SDD-03 §1) and one person may belong to several tenants (FR-002), so
authentication has to find a user by email before any tenant is known — a
tenant policy there would break login.

Tenant-scoped access to people goes through `tenant_users`, which is
protected. Anything exposing user records through the API must join through
membership rather than reading `users` directly.
