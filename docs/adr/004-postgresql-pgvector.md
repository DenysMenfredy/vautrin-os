# ADR-004 — PostgreSQL + pgvector

- Status: Accepted
- Date: 2026-09-19

## Context

The platform needs relational business state and semantic retrieval for tenant
knowledge.

## Decision

Use PostgreSQL as the source of truth and pgvector for embeddings.

Structured data stays relational.

Unstructured knowledge is chunked and embedded in PostgreSQL.

## Consequences

Positive:
- one primary database;
- transactional consistency;
- simpler operations;
- tenant isolation can apply to vector data;
- lower MVP complexity.

Negative:
- vector workload must be monitored;
- very large-scale retrieval may eventually require specialized infrastructure.

## Migration path

If vector workload outgrows PostgreSQL, introduce a vector provider adapter without
changing the domain-level knowledge interface.
