# SDD-05 — Multi-Tenancy

## 1. Model

Use a pooled PostgreSQL multi-tenant model.

All tenant data resides in shared database infrastructure with logical isolation.

## 2. Tenant context

The active tenant is derived from:
1. authenticated identity;
2. tenant membership;
3. explicit server-side tenant selection where the user belongs to multiple tenants.

A client-provided arbitrary tenant ID is never sufficient authorization.

## 3. Request flow

```text
HTTP request
  ↓
Authentication
  ↓
Tenant membership resolution
  ↓
TenantContext
  ↓
Authorization
  ↓
Application service
  ↓
Repository
  ↓
PostgreSQL
```

## 4. RLS

All tenant-scoped tables should have PostgreSQL Row Level Security enabled.

The application must set a database session/transaction tenant context safely
before executing tenant-scoped operations.

Example conceptual policy:

```sql
CREATE POLICY tenant_isolation
ON leads
USING (tenant_id = current_setting('app.tenant_id')::uuid)
WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
```

Implementation must account for connection pooling and transaction boundaries.

## 5. Background jobs

Every job must carry enough context to reconstruct:
- tenant ID;
- actor/system identity where applicable;
- correlation ID;
- idempotency key where relevant.

A worker must never infer tenant context from mutable global process state.

## 6. Tenant isolation tests

Required tests include:
- SELECT isolation;
- INSERT isolation;
- UPDATE isolation;
- DELETE isolation;
- vector/knowledge isolation;
- conversation isolation;
- workflow isolation;
- background job isolation.

## 7. Noisy neighbor

At MVP scale, shared infrastructure is acceptable.

As customer volume grows, monitor:
- database CPU;
- connection usage;
- slow queries;
- queue depth;
- worker saturation;
- tenant-specific request volume.

Future isolation options may include:
- rate limits;
- queue partitioning;
- read replicas;
- dedicated infrastructure for enterprise tenants.

## 8. Tenant deletion

Tenant deletion must be an explicit lifecycle operation with:
- authorization;
- audit;
- data retention policy;
- asynchronous cleanup;
- provider credential revocation.
