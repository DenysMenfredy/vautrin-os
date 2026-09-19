# ADR-003 — Pooled Multi-Tenancy

- Status: Accepted
- Date: 2026-09-19

## Context

The product must support many local businesses without provisioning an entire
application stack per customer.

## Decision

Use a pooled PostgreSQL model with logical tenant isolation.

Every tenant-scoped row contains `tenant_id`.

Tenant isolation is enforced at:
1. application context;
2. repository/query boundaries;
3. PostgreSQL RLS;
4. automated tests.

## Consequences

Positive:
- simple onboarding;
- low infrastructure overhead;
- efficient resource utilization;
- shared migrations.

Negative:
- stronger isolation engineering is required;
- noisy-neighbor behavior must be monitored.

## Future

Enterprise tenants may receive dedicated databases/stacks if commercial or
security requirements justify it.
