# ADR-009 — Redis + BullMQ

- Status: Accepted
- Date: 2026-09-19

## Context

The platform needs delayed jobs, retries, background AI work, webhook handling,
and workflow execution.

## Decision

Use Redis + BullMQ via NestJS's BullMQ integration.

Queues are processed by `apps/worker`.

## Queue categories

Initial logical queues:
- `workflow`;
- `ai`;
- `notifications`;
- `webhooks`.

## Consequences

Positive:
- mature Redis-backed queue model;
- delayed/retryable jobs;
- independent worker scaling;
- good NestJS integration.

Negative:
- Redis becomes operational infrastructure;
- job payloads must remain serializable and safe;
- idempotency remains an application responsibility.
