# ADR-009 — Redis + BullMQ for V1 Asynchronous Execution

- Status: Accepted
- Date: 2026-09-23
- Supersedes: ADR-009 revision dated 2026-09-19

## Context

Vautrin V1 is a modular monolith targeting the first 10 paying remodeling/home-services businesses. Its asynchronous workload is predominantly job-oriented: delayed lead follow-up, AI execution, outbound messaging, webhook processing, workflow steps, retries, and scheduled work.

Google Pub/Sub was evaluated as part of the GCP deployment decision. Pub/Sub is a strong event-distribution system, but adopting it in V1 would introduce a second asynchronous mental model without solving a current product requirement. Delayed and scheduled workflow execution would still require another mechanism such as Cloud Tasks or application-managed scheduling.

The existing repository already contains `@vautrin/queues`, BullMQ registration, Redis integration tests, worker tenant-context handling, and four logical queues. Replacing this before the first customer would create migration work without customer value.

## Decision

Vautrin V1 SHALL use Redis + BullMQ through NestJS BullMQ integration.

Redis/BullMQ is the execution transport, not the system of record. PostgreSQL remains authoritative for business state, workflow state, audit state, idempotency state, and durable domain events.

`apps/worker` SHALL process BullMQ jobs independently from `apps/api`.

`@vautrin/queues` SHALL own shared queue names, serializable job contracts, retry defaults, Redis connection configuration, and common queue metadata.

## Initial logical queues

- `workflow` — durable-event dispatch, workflow evaluation, delayed steps, workflow actions;
- `ai` — LLM/agent/embedding work;
- `notifications` — SMS, email, push and other outbound communication jobs;
- `webhooks` — asynchronous provider webhook processing where applicable.

Queue proliferation is discouraged. Add a new queue only when workload isolation, concurrency, rate limiting, or failure semantics materially require it.

## Durable event boundary

Business mutations that must trigger asynchronous behavior SHALL write the business state and an outbox/event record in the same PostgreSQL transaction.

A dispatcher SHALL claim unpublished events and enqueue a BullMQ job containing at minimum:

- `eventId`;
- `tenantId`;
- `correlationId` when available;
- actor metadata when available;
- an idempotency key when the operation can create external side effects.

The dispatcher SHALL mark an event dispatched only after queue submission succeeds. Dispatch must tolerate retries and process crashes.

## Delivery semantics

Vautrin assumes at-least-once job execution.

Every side-effecting processor SHALL therefore be idempotent. External effects such as sending an SMS, booking an appointment, or invoking a provider mutation must use an application-level idempotency strategy where supported and a durable local idempotency record where necessary.

Retries SHALL be bounded. Failed jobs SHALL remain inspectable long enough for operational diagnosis. Poison jobs must not retry indefinitely.

## Delays and scheduling

BullMQ delayed jobs SHALL implement short/medium workflow waits such as follow-up in 30 seconds, 2 hours, 1 day, or 3 days.

The durable workflow run in PostgreSQL remains authoritative. A delayed BullMQ job is a wake-up mechanism, not the only record that a future step exists.

Long-lived workflow waits must therefore be recoverable by reconciliation from PostgreSQL if Redis data is lost or a job is removed unexpectedly.

## Tenant isolation

Every tenant-scoped job SHALL carry `tenantId`. Workers SHALL validate the job contract and re-establish PostgreSQL RLS tenant context before tenant-scoped access.

Workers must never infer tenant context from process-global mutable state.

## Redis scope

For V1 Redis is required for BullMQ. It MAY additionally support narrowly defined ephemeral concerns such as rate limiting or cache entries, but Redis SHALL NOT become the authoritative store for customer, workflow, auth, billing, or audit data.

## GCP production deployment

Redis SHALL be deployed as a private managed Redis service on GCP when production reliability justifies it. Local development continues to use the repository's Redis Docker container.

The application SHALL depend on Redis through configuration and BullMQ abstractions; domain modules SHALL NOT import GCP-specific infrastructure APIs.

## Pub/Sub decision

Google Pub/Sub is explicitly DEFERRED for V1.

Re-evaluate Pub/Sub when at least one of these conditions exists:

1. a domain event needs multiple independently deployed/scaled subscribers;
2. analytics/integration consumers should consume the same event stream independently of workflow execution;
3. BullMQ queue coupling materially impedes service extraction;
4. throughput or cross-system event distribution becomes an observed constraint;
5. a customer/integration requirement needs managed event fan-out.

If introduced later, Pub/Sub SHOULD primarily distribute domain/integration events. It does not automatically replace BullMQ's job/scheduling semantics.

## Consequences

### Positive

- preserves the already implemented queue foundation;
- delayed jobs and retries map directly to Vautrin workflows;
- one asynchronous execution model for the first 10 customers;
- straightforward NestJS integration;
- independent API/worker scaling;
- portable across cloud providers;
- avoids premature distributed event-bus complexity.

### Negative

- Redis is a production dependency;
- Vautrin owns more queue behavior than with a fully managed event bus;
- fan-out to many independent consumers is less natural;
- Redis failure/recovery must be operationally understood;
- application-level idempotency remains mandatory.

## Review trigger

Review this ADR after either 100 active tenants, extraction of the first independently deployed domain service, or evidence that event fan-out/throughput is limiting delivery — whichever occurs first.
