# ADR-012 — Observability Baseline

- Status: Accepted
- Date: 2026-09-19

## Context

AI workflows involve asynchronous execution and external providers. Debugging
without correlation data will be expensive.

## Decision

Implement structured logs and correlation IDs from the beginning.

Record:
- request/job ID;
- correlation ID;
- tenant ID;
- actor ID where applicable;
- workflow run;
- agent run;
- tool execution;
- provider/model;
- latency;
- error state.

## Consequences

Positive:
- faster debugging;
- tenant-aware support;
- AI cost visibility;
- operational analytics.

Negative:
- telemetry storage has a cost;
- sensitive data must be deliberately filtered.
