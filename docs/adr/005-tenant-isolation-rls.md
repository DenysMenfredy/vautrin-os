# ADR-005 — PostgreSQL RLS for Tenant Isolation

- Status: Accepted
- Date: 2026-09-19

## Context

Application-only tenant filtering is vulnerable to accidental omissions.

## Decision

Use PostgreSQL Row Level Security for tenant-scoped tables in addition to
application-level tenant context.

The active tenant is passed through a safe transaction/session context.

## Consequences

Positive:
- defense in depth;
- database-level enforcement;
- protection against accidental query omissions.

Negative:
- connection pooling and transaction boundaries require careful implementation;
- test setup is more involved;
- privileged database roles require explicit handling.

## Rule

RLS is not a replacement for application authorization. Both are required.
