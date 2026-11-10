# ADR-018 — Separate Platform Authorization from Tenant RBAC

**Status:** Proposed
**Date:** 2026-11-10
**Decision owners:** Platform Engineering / Security
**Related:** SDD-13, ADR-017

---

## Context

Vautrin has global users and tenant-scoped memberships/roles.

Tenant roles such as:

```text
OWNER
ADMIN
MANAGER
STAFF
READ_ONLY
```

authorize actions inside one tenant.

The Platform Admin Console requires different privileges:

- list all users;
- list all tenants;
- create tenants;
- invite users across tenants;
- modify memberships;
- disable/delete users;
- suspend/archive tenants;
- view platform-wide analytics.

Mapping these capabilities onto tenant roles would break the multi-tenant authorization model and create a serious privilege-escalation risk.

---

## Decision

Vautrin will introduce a separate Platform Authorization domain.

```text
User
 │
 ├── TenantMembership[]
 │      └── tenant-scoped roles
 │
 └── PlatformAccess?
        └── platform-scoped role
```

V1 roles:

```text
SUPER_ADMIN
OPERATOR
SUPPORT_READ_ONLY
```

Do not implement platform privilege as:

```text
User.isAdmin
```

Do not infer platform access from tenant ownership.

---

## Authorization Contract

Every `/api/admin/*` request requires:

```text
authenticated identity
        +
admin session/audience
        +
PlatformAccess exists
        +
PlatformAccess ACTIVE
        +
required permission
```

Tenant membership does not grant platform access.

---

## Database Access Decision

Cross-tenant queries must use an explicit platform repository/data-access path.

Do not reuse tenant repositories and simply omit `tenantId`.

Recommended:

```text
AdminModule
    ↓
PlatformRepository
    ↓
DATABASE_PLATFORM_URL
    ↓
vautrin_platform_admin PostgreSQL role
```

The platform DB role should:

- have only required table privileges;
- receive explicit RLS policies where needed;
- avoid broad `BYPASSRLS` when narrower policies are sufficient;
- not expose provider-secret tables unless explicitly necessary.

---

## Session Decision

Admin activity should use a dedicated session context/audience:

```text
audience = platform-admin
```

Admin and tenant cookies should use distinct names.

Where admin requests are same-origin on `admin.${BASE_DOMAIN}`, prefer a host-only:

```text
Secure
HttpOnly
SameSite=Strict
```

cookie.

---

## Privilege Rules

### SUPER_ADMIN

May:

- grant/revoke platform access;
- perform all operator functions;
- logically delete users;
- manage platform administrators.

Protections:

- cannot delete own active identity;
- cannot remove the last active SUPER_ADMIN.

### OPERATOR

May:

- create tenants;
- invite users;
- manage memberships;
- edit safe user metadata;
- disable/re-enable users;
- suspend/reactivate/archive tenants.

Logical deletion remains SUPER_ADMIN-only by default.

### SUPPORT_READ_ONLY

Read-only platform visibility.

No user/tenant/membership/platform-access mutation.

---

## User Deletion Decision

V1 uses logical deletion.

Logical deletion:

```text
revokes sessions
prevents authentication
deactivates memberships
preserves references
preserves audit history
hides from active lists
```

Permanent data purge is a separate privacy/data-retention operation.

---

## Audit Decision

Every platform mutation produces a platform audit event containing:

```text
actor
platform role
action
target
tenant when relevant
reason when relevant
timestamp
request/correlation ID
outcome
```

Never store secrets, password hashes, tokens, or provider credentials in audit metadata.

---

## Alternatives Considered

### A. `User.isAdmin`

Rejected because it lacks permission granularity and encourages scattered boolean privilege checks.

### B. Tenant OWNER as platform admin

Rejected because tenant ownership is tenant-scoped. Elevating it to platform privilege would be a multi-tenant security defect.

### C. Special “Vautrin admin tenant”

Rejected because it overloads tenant semantics and complicates RLS.

### D. Database superuser

Rejected as the normal admin execution model because of excessive blast radius.

---

## Consequences

### Positive

- explicit platform privilege;
- tenant RBAC remains clean;
- least privilege is possible;
- security tests are clearer;
- cross-tenant access has one auditable boundary.

### Negative

- new PlatformAccess model;
- admin-specific guards/session;
- dedicated cross-tenant repository;
- additional DB grants/RLS policies;
- more security testing.

These costs are accepted because platform administration is a materially higher-risk privilege domain.

---

## Required Invariants

```text
Tenant OWNER ≠ Platform Admin

Platform Admin ≠ Tenant membership

Browser-provided tenantId ≠ authorization

Frontend visibility ≠ authorization

Platform query ≠ tenant repository without filter
```

---

## Decision Outcome

Adopt a distinct platform-authorization domain with explicit roles, admin-specific authorization, controlled cross-tenant database access, logical user deletion, and append-only platform audit logging.
