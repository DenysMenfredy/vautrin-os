# ADR-007 — Declarative Workflow Engine

- Status: Accepted
- Date: 2026-09-19

## Context

The business requires many automations that share common behavior:
triggers, waits, conditions, AI actions, messages, booking, and escalation.

Hardcoding each workflow would create duplication and make vertical expansion costly.

## Decision

Implement a declarative workflow engine with:
- triggers;
- versioned definitions;
- generic steps;
- retries;
- idempotency;
- persisted runs;
- failure policies.

## Consequences

Positive:
- reusable automation infrastructure;
- vertical templates;
- customer-specific workflows;
- easier future workflow builder.

Negative:
- workflow engine is a significant subsystem;
- execution semantics must be tested carefully.

## MVP constraint

Only implement the step types required by the first revenue workflow.
