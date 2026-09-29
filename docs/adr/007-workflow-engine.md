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

Condition branching uses a bounded structured DSL evaluated against a
tenant-scoped runtime context. The evaluator is pure and has no database,
network, JavaScript, SQL, or LLM access. Condition trees, permitted context
fields, and branch targets are validated before activation; branch references
are forward-only until a bounded-loop model is explicitly designed. The
runtime persists the condition, result, selected branch, and audit record with
the step execution. A false result is a successful completed step, not an
execution error.

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
