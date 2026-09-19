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
