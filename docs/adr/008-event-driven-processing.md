# ADR-008 — Event-Driven Internal Processing

- Status: Accepted
- Date: 2026-09-19

## Context

Lead, conversation, appointment, and estimate changes can trigger asynchronous behavior.

## Decision

Use durable internal events as the primary trigger mechanism for workflows.

Examples:
- `lead.created`;
- `call.missed`;
- `message.received`;
- `appointment.created`;
- `estimate.sent`.

## Consequences

Positive:
- loose coupling;
- replayable processing;
- natural workflow triggers;
- easier observability.

Negative:
- eventual consistency;
- event schema/versioning required;
- duplicate delivery must be handled.

## Rule

Business state remains in PostgreSQL. Events trigger work; they are not the
canonical replacement for business state.

## V0.2 event boundary

`lead.created` and `lead.status_changed` have explicit version 1 payload
contracts in `@vautrin/contracts`. A lead mutation writes the event outbox row
in the same PostgreSQL transaction as the lead and audit record. Consumers
must validate the event version and payload before acting. An unpublished row
remains durable if Redis is unavailable; dispatch and workflow execution are
separate backlog items (VOS-083 and related workflow work).

## V0.3 dispatch boundary

The worker polls a narrow `app.pending_event_tenants` function that exposes
only tenant IDs and oldest pending timestamps. It then claims unpublished
rows per tenant under FORCE RLS with `FOR UPDATE SKIP LOCKED`, submits stable
BullMQ job IDs, and sets `published_at` only after submission succeeds. A
crash before commit can replay the job; consumers use durable PostgreSQL
idempotency keys. The first consumer creates one pending workflow run per
active matching workflow/version and audits creation. It does not yet execute
workflow steps or external side effects.

The internal inbound-message path writes the message, last-activity update,
`message.received` v1 outbox event, and integration audit in one tenant-scoped
transaction. It is not exposed as a public webhook until provider signature
verification and trusted integration-to-tenant resolution are implemented.
