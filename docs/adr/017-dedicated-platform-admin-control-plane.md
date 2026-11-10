# ADR-017 — Dedicated Platform Admin Control Plane

**Status:** Proposed
**Date:** 2026-11-10
**Decision owners:** Platform Engineering
**Related:** SDD-13, ADR-018

---

## Context

Vautrin OS requires an internal interface for Vautrin operators to view platform-wide metrics and manage users and tenants.

The tenant-facing application is tenant-scoped and protected by tenant membership, RBAC, and PostgreSQL RLS. Platform administration is different because it requires privileged cross-tenant reads and controlled cross-tenant mutations.

The admin experience must not become an ordinary tenant page with hidden controls or a tenant role such as `OWNER`.

---

## Decision

Vautrin will implement a dedicated Platform Admin Control Plane with:

```text
apps/admin
```

served from:

```text
admin.${BASE_DOMAIN}
```

The existing NestJS API remains the system-of-record backend.

Admin APIs live under:

```text
/api/admin/*
```

inside a dedicated platform-administration module.

No new admin microservice is introduced in V1.

---

## Routing

Recommended production routing:

```text
admin.${BASE_DOMAIN}/*
        ↓
Admin static frontend

admin.${BASE_DOMAIN}/api/admin/*
        ↓
NestJS API
```

This preserves same-origin browser behavior for the Admin Console.

---

## Why a Separate Frontend

A separate frontend bundle provides:

- a clearer security boundary;
- less risk of accidentally exposing admin routes in customer navigation;
- independent deployment;
- host-specific cookie/CSP policy;
- a visibly distinct operational UI;
- less conditional logic in the customer application.

The admin app may reuse shared Vautrin design tokens/components.

---

## Why Not a Separate Backend Service

V1 does not require independent scaling/deployment of admin functionality.

A separate service would add:

- duplicated auth;
- duplicated domain/application logic;
- cross-service transactions;
- additional observability/deployment complexity.

That conflicts with Vautrin's modular-monolith strategy.

The Admin module should call existing application services for business operations rather than duplicating them.

---

## Alternatives Considered

### A. Put `/admin` inside `apps/web`

Rejected.

Pros:

- fewer deployables.

Cons:

- customer and platform control planes are coupled;
- greater route/authorization risk;
- privileged UI ships in the same frontend bundle;
- harder to apply independent host/cookie policies.

### B. New admin microservice

Rejected for V1.

Pros:

- strong process isolation.

Cons:

- unnecessary distributed-system complexity;
- harder transactions;
- duplicate identity/domain coordination.

### C. Direct DB scripts only

Rejected.

This lacks operational safety, auditability, permission control, and usability.

---

## Consequences

### Positive

- clean control-plane separation;
- customer app stays tenant-focused;
- privileged UX can be secured independently;
- no backend microservice complexity;
- existing application services remain reusable.

### Negative

- one additional frontend build/deployment;
- shared UI components may need extraction;
- load balancer needs admin host rules;
- admin-specific session handling is required.

---

## Security Consequences

`admin.${BASE_DOMAIN}` is not a security boundary by itself.

The API remains authoritative.

Tenant roles must never grant platform-admin access.

Platform authorization follows ADR-018.

---

## Decision Outcome

Adopt:

```text
apps/admin
+
admin.${BASE_DOMAIN}
+
/api/admin/*
+
shared NestJS modular-monolith backend
```

Do not create an admin microservice for V1.
