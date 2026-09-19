# @vautrin/worker

Asynchronous job processing for Vautrin OS (VOS-005, ADR-009).

A NestJS **standalone context** — it consumes BullMQ queues and exposes no
HTTP port (SDD-02 §3).

## Run

```bash
docker compose -f infra/docker-compose.yml up -d
pnpm --filter @vautrin/worker dev
```

## Queues

Four logical queues (ADR-009), because these workloads behave differently and
one shared queue would let any of them starve the others:

| Queue | Carries |
|---|---|
| `workflow` | Workflow steps, including delayed ones (SDD-07 §9) |
| `ai` | Agent runs and embedding work (SDD-06) |
| `notifications` | Outbound messages through provider adapters |
| `webhooks` | Inbound provider callbacks (SDD-08 §5) |

Defaults on every job: 3 attempts with exponential backoff, completed jobs
trimmed after an hour, failed jobs kept a day. Bounded retries are required
by SDD-07 §7 — unbounded retries turn one poisoned job into a permanent load
source.

## Tenant context in jobs

A job has no ambient request, so the tenant travels in the payload and is
validated on arrival (SDD-05 §5 — "a worker must never infer tenant context
from mutable global process state"):

```ts
await this.database.withJobTenant(job.data, async (tx, context) => {
  // tx is scoped to context.tenantId
});
```

A payload that lost its tenant throws rather than quietly running with no
context and appearing to succeed against zero rows.

## Idempotency

Retries mean a step can run more than once. The queue does not solve this —
side-effecting steps carry an idempotency key enforced by a unique constraint
in the database (SDD-07 §6). The same SMS must not go out twice because a
worker retried.

## A note on the Redis client

BullMQ loads `ioredis` with a lazy `require()`, which fails in this app
because it is native ESM. `createRedisConnection` therefore builds and passes
an already-constructed client. `maxRetriesPerRequest: null` is mandatory: with
a retry limit, a blocking command that outlives a reconnect throws instead of
resuming, and the worker silently stops consuming.

## Not here yet

Processors. They arrive with their own backlog items: workflow execution
(VOS-083), wait and condition steps (VOS-084/085), outbound messaging
(VOS-086), agent invocation (VOS-087), webhook ingestion (VOS-064). Also
pending: structured logging (VOS-120) and the Dockerfile (VOS-023).
