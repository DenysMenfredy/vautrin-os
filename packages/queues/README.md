# @vautrin/queues

Shared BullMQ configuration for Vautrin OS (VOS-012, ADR-009).

Exports the four queue names (`workflow`, `ai`, `notifications`, `webhooks`),
bounded retry defaults, an ESM-compatible Redis connection, and the
tenant-bearing durable-event job contract. Jobs carry tenant context
explicitly; future processors must validate it before opening a tenant-scoped
database transaction. Retries still require application-level idempotency for
external side effects.

The package defines infrastructure contracts. Workflow, provider, and AI
processors arrive with their own backlog items.
