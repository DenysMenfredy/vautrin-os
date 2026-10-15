# ADR-016 — Shared revenue application capabilities

- Status: Accepted
- Date: 2026-10-14

The v0.3 worker needs the same booking and qualification rules as HTTP users.
Importing the HTTP application into the worker creates an application dependency;
duplicating rules would let an AI tool bypass the rules enforced by the API.

`@vautrin/revenue` contains provider-neutral application capabilities and pure
policies. It accepts a tenant transaction port and provider interfaces. The API
adapts domain failures to HTTP; worker tools provide explicit AGENT audit identity.
Controllers and vendor SDK types stay outside this package.

Long-running model calls run on the AI queue after PostgreSQL records an actionable
workflow step. The reconciler recreates missing jobs. Completion marks the step
complete and makes the run pending again; replay resumes after completed steps.
Tools validate entity relationships against the bound conversation and tenant.
Only typed qualification, contact capture, availability, booking and handoff
capabilities are exposed. Outbound text is queued through the existing durable
outbox and suppression policy; it is never sent directly by a model.

Provider retries persist their attempt counts and next due times in PostgreSQL,
using the workflow retry limits/backoff/error classification. Redis reconstruction
cannot reset those counts. Queued automation messages retain their workflow
identity and recheck cancellation/handoff before provider acceptance. A claimed
external action already in flight can complete and must be reconciled by an
operator; cancellation cannot undo a provider mutation.
