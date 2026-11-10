# SDD-13 — Vautrin Platform Admin Console

**Status:** Proposed
**Version:** 1.0
**Target release:** Post-v0.3 / Admin control-plane increment
**Owner:** Platform Engineering
**Audience:** Engineering, Product, Security, Operations
**Related ADRs:** ADR-017, ADR-018
**Primary host:** `admin.${BASE_DOMAIN}`
**Example:** `admin.vautrincompany.com`

---

## 1. Purpose

Vautrin OS requires an internal platform-administration interface for Vautrin operators to manage the SaaS control plane without direct database access.

The Admin Console is distinct from the tenant-facing Vautrin OS application. It provides cross-tenant visibility and controlled platform operations such as:

- viewing platform-level user and tenant metrics;
- viewing user-registration trends over time;
- listing and searching users;
- creating/inviting customer users;
- creating tenants;
- assigning users to tenants;
- modifying users and memberships;
- disabling or logically deleting users;
- suspending or archiving tenants;
- inspecting auditable platform-management actions.

The Admin Console MUST NOT become a general backdoor around tenant authorization, RLS, business rules, or provider security.

---

## 2. Goals

V1 MUST provide:

1. A dedicated internal admin application under `admin.${BASE_DOMAIN}`.
2. Platform-admin authentication and authorization independent of tenant membership roles.
3. A dashboard showing:
   - total registered users;
   - total active users;
   - total tenants;
   - active tenants;
   - users registered in the current month;
   - tenants created in the current month;
   - user registrations by month;
   - tenant registrations by month, if inexpensive to expose.
4. User management:
   - search;
   - filter;
   - inspect;
   - invite/register;
   - edit profile metadata;
   - inspect tenant memberships;
   - add/remove memberships;
   - change tenant role;
   - suspend/disable;
   - logically delete.
5. Tenant management:
   - search;
   - filter;
   - inspect;
   - create;
   - edit business-level platform metadata;
   - invite/create first OWNER;
   - suspend;
   - reactivate;
   - archive.
6. Full auditability of platform-admin actions.
7. Strong separation between platform authorization, tenant authorization, and tenant data access.
8. A responsive internal UI following the Vautrin design system.

---

## 3. Non-Goals

V1 does NOT include:

- public self-service tenant registration;
- customer billing management;
- subscription plan management;
- impersonation / “login as customer”;
- arbitrary SQL/database access;
- provider-secret display;
- Twilio/Google credential editing;
- permanent user data purge from the normal UI;
- permanent tenant purge;
- bulk user import;
- advanced BI/warehouse analytics;
- cohort retention analytics;
- revenue analytics;
- feature-flag administration;
- support ticketing;
- multi-region operations.

---

## 4. Architectural Context

Existing Vautrin OS architecture remains:

```text
apps/web       → tenant-facing Nuxt application
apps/api       → NestJS system-of-record API
apps/worker    → BullMQ asynchronous worker

PostgreSQL     → authoritative state
Redis/BullMQ   → asynchronous execution
```

V1 adds:

```text
apps/admin     → internal Nuxt admin application
```

The backend remains a modular monolith. No new admin microservice is introduced.

---

## 5. External Topology

Recommended production routing:

```text
                         Internet
                            │
                    HTTPS Load Balancer
                       /            \
                      /              \
      app.${BASE_DOMAIN}        admin.${BASE_DOMAIN}
              │                         │
        ┌─────┴─────┐             ┌─────┴─────┐
        │           │             │           │
       /*        /api/*          /*       /api/admin/*
        │           │             │           │
        ▼           ▼             ▼           ▼
  Tenant GCS     NestJS API    Admin GCS    NestJS API
   + CDN                                     same backend
```

The admin frontend MUST be separately built and deployed from the tenant application.

The admin API remains part of `apps/api`, under an explicit platform-admin module.

---

## 6. Host and Routing Contract

Canonical admin host:

```text
admin.${BASE_DOMAIN}
```

Admin routes:

```text
/
├── /login
├── /dashboard
├── /users
│   └── /users/:userId
├── /tenants
│   └── /tenants/:tenantId
└── /audit
```

Admin backend routes:

```text
/api/admin/session
/api/admin/dashboard
/api/admin/analytics/*
/api/admin/users/*
/api/admin/tenants/*
/api/admin/invitations/*
/api/admin/audit/*
```

The load balancer SHOULD preserve same-origin browser calls:

```text
admin.${BASE_DOMAIN}/api/admin/*
              ↓
          NestJS API
```

---

## 7. Security Principles

The Admin Console is a privileged control plane.

Mandatory principles:

1. Platform privilege is NOT derived from tenant membership.
2. Tenant `OWNER` is NOT a platform administrator.
3. Platform administrators MUST have explicit platform access.
4. Admin endpoints MUST reject normal tenant sessions.
5. Admin operations MUST never trust browser-supplied tenant or role data without server-side authorization.
6. Cross-tenant DB access MUST use a dedicated repository/data-access boundary.
7. Every state-changing platform action MUST be audited.
8. Destructive operations MUST be idempotent where appropriate.
9. User disable/delete MUST revoke active sessions.
10. Provider credentials, refresh-token hashes, password hashes, secrets, and sensitive auth internals MUST NOT be returned by admin APIs.

---

## 8. Platform Authorization Model

### Roles

```ts
export enum PlatformRole {
  SUPER_ADMIN = "SUPER_ADMIN",
  OPERATOR = "OPERATOR",
  SUPPORT_READ_ONLY = "SUPPORT_READ_ONLY",
}
```

| Capability | SUPER_ADMIN | OPERATOR | SUPPORT_READ_ONLY |
|---|---:|---:|---:|
| View dashboard/users/tenants/audit | Yes | Yes | Yes |
| Invite user | Yes | Yes | No |
| Edit user | Yes | Yes | No |
| Manage memberships | Yes | Yes | No |
| Create/edit tenant | Yes | Yes | No |
| Suspend/reactivate tenant | Yes | Yes | No |
| Disable user | Yes | Yes | No |
| Logical user delete | Yes | No by default | No |
| Grant/revoke platform access | Yes | No | No |

Do not collapse platform privilege into `User.isAdmin`.

---

## 9. Platform Access Data Model

```prisma
enum PlatformRole {
  SUPER_ADMIN
  OPERATOR
  SUPPORT_READ_ONLY
}

enum PlatformAccessStatus {
  ACTIVE
  SUSPENDED
}

model PlatformAccess {
  id              String               @id @default(uuid())
  userId          String               @unique
  role            PlatformRole
  status          PlatformAccessStatus @default(ACTIVE)

  createdByUserId String?
  createdAt       DateTime             @default(now())
  updatedAt       DateTime             @updatedAt

  user            User                 @relation(fields: [userId], references: [id])

  @@index([role, status])
}
```

---

## 10. Admin Session

The admin frontend MAY reuse the existing global identity/authentication mechanism, but successful admin access MUST produce a server-validated platform-admin session context.

```ts
interface PlatformPrincipal {
  userId: string;
  platformRole: PlatformRole;
  sessionId: string;
  audience: "platform-admin";
}
```

Admin APIs require:

```text
audience = platform-admin
+
PlatformAccess.status = ACTIVE
+
permission check
```

The session MUST NOT use a tenant as its authorization boundary.

For same-origin admin routing, prefer a dedicated admin cookie:

```text
Secure
HttpOnly
SameSite=Strict
Path=/
No Domain attribute
```

Tenant and admin cookies SHOULD use distinct names.

---

## 11. User Lifecycle

### States

Use an equivalent lifecycle:

```text
PENDING
ACTIVE
DISABLED
DELETED
```

If the existing User model lacks lifecycle fields, add equivalent state/timestamps such as:

```text
disabledAt
deletedAt
```

### Registration

V1 remains operator-controlled.

“Register user” means:

```text
Admin selects tenant + role + email
        ↓
Create invitation
        ↓
User accepts
        ↓
Global User created or reused
        ↓
Tenant membership activated
```

The administrator MUST NOT choose or know the customer password.

If the email already belongs to a global User, reuse that identity.

### Modify user

Editable safe fields MAY include:

```text
display name
verified email-change flow if supported
user status
tenant memberships
tenant roles
```

Never expose auth secrets or token hashes.

### Disable user

```text
User → DISABLED
        ↓
revoke sessions
        ↓
prevent login
        ↓
preserve memberships/history
        ↓
audit
```

### Delete user

V1 delete is logical deletion:

```text
User → DELETED
        ↓
revoke sessions
        ↓
prevent authentication
        ↓
deactivate memberships
        ↓
preserve audit/history references
        ↓
hide from active lists
```

Permanent physical purge is outside the normal V1 Admin Console.

---

## 12. Tenant Lifecycle

Recommended states:

```text
ACTIVE
SUSPENDED
ARCHIVED
```

### Create tenant

Form:

```text
tenant/business name
timezone
vertical/template
initial OWNER email (optional)
```

Flow:

```text
Admin creates tenant
        ↓
tenant persisted
        ↓
default configuration created
        ↓
optional template applied
        ↓
OWNER invitation created
        ↓
audit
```

Reuse existing tenant-provisioning services.

### Suspend

Suspension preserves data and audit history and is reversible.

### Archive

Archive is non-destructive.

Hard tenant deletion is out of scope.

---

## 13. Dashboard Requirements

Path:

```text
/dashboard
```

### KPI summary

V1 displays:

```text
Total registered users
Active users
Disabled users
Total tenants
Active tenants
Users created this month
Tenants created this month
```

Optional:

```text
Pending invitations
Suspended tenants
```

### Users per month

Default:

```text
last 12 calendar months
```

Chart:

```text
Line chart
X = month
Y = user registrations
```

Definition:

```sql
count(User.id)
group by calendar month of User.createdAt
```

Zero-registration months MUST be included.

### Tenants per month

Same shape as users-per-month.

### Time semantics

Use UTC calendar boundaries in V1 unless explicitly changed later.

---

## 14. Dashboard API

### GET `/api/admin/dashboard`

```json
{
  "generatedAt": "2026-11-10T17:00:00Z",
  "timezone": "UTC",
  "summary": {
    "usersTotal": 128,
    "usersActive": 121,
    "usersDisabled": 5,
    "usersDeleted": 2,
    "tenantsTotal": 19,
    "tenantsActive": 17,
    "usersCreatedThisMonth": 12,
    "tenantsCreatedThisMonth": 3,
    "pendingInvitations": 4
  }
}
```

### GET `/api/admin/analytics/users-per-month?months=12`

```json
{
  "timezone": "UTC",
  "period": {
    "months": 12,
    "from": "2025-12-01T00:00:00Z",
    "to": "2026-11-30T23:59:59Z"
  },
  "series": [
    { "month": "2025-12", "count": 0 },
    { "month": "2026-01", "count": 3 }
  ]
}
```

### GET `/api/admin/analytics/tenants-per-month?months=12`

Same response shape.

---

## 15. Analytics Implementation

No warehouse is required for V1.

Use PostgreSQL aggregate queries and indexes:

```text
users(created_at)
tenants(created_at)
```

If lifecycle fields exist:

```text
users(status, created_at)
tenants(status, created_at)
```

Live aggregation is acceptable at current scale.

An optional short cache may be added later, but it MUST NOT become the source of truth.

---

## 16. User Management API

### GET `/api/admin/users`

Filters:

```text
q
status
tenantId
role
createdFrom
createdTo
cursor
limit
sort
```

Defaults:

```text
limit = 25
max = 100
sort = createdAt:desc
```

### GET `/api/admin/users/:userId`

Returns:

```text
safe user profile
lifecycle status
created/updated timestamps
last login if available
tenant memberships
platform access only when caller is authorized
```

### POST `/api/admin/invitations`

```json
{
  "email": "owner@example.com",
  "tenantId": "uuid",
  "role": "OWNER"
}
```

Must reuse the existing invitation flow.

### PATCH `/api/admin/users/:userId`

Allowlisted fields only.

### POST `/api/admin/users/:userId/disable`

```json
{
  "reason": "Support/security reason"
}
```

### POST `/api/admin/users/:userId/enable`

Audited.

### DELETE `/api/admin/users/:userId`

Logical deletion.

```json
{
  "reason": "Requested by operator",
  "confirmation": "DELETE"
}
```

Recommended: SUPER_ADMIN only.

---

## 17. Membership Management API

### POST `/api/admin/users/:userId/memberships`

```json
{
  "tenantId": "uuid",
  "role": "MANAGER"
}
```

### PATCH `/api/admin/users/:userId/memberships/:membershipId`

```json
{
  "role": "ADMIN"
}
```

### DELETE `/api/admin/users/:userId/memberships/:membershipId`

Removes/deactivates membership only; it does not delete the global user.

---

## 18. Tenant Management API

### GET `/api/admin/tenants`

Filters:

```text
q
status
createdFrom
createdTo
cursor
limit
sort
```

### GET `/api/admin/tenants/:tenantId`

Returns safe metadata plus:

```text
user count
active user count
created at
status
business profile summary
```

### POST `/api/admin/tenants`

```json
{
  "name": "Acme Remodeling",
  "timezone": "America/Phoenix",
  "template": "remodeling",
  "owner": {
    "email": "owner@acme.example"
  }
}
```

### PATCH `/api/admin/tenants/:tenantId`

Allowlisted fields only.

### POST `/api/admin/tenants/:tenantId/suspend`

Requires reason.

### POST `/api/admin/tenants/:tenantId/reactivate`

Audited.

### POST `/api/admin/tenants/:tenantId/archive`

Non-destructive.

---

## 19. Database Access Boundary

Do not implement admin queries by taking tenant repositories and simply omitting `tenantId`.

Required path:

```text
AdminController
      ↓
AdminApplicationService
      ↓
PlatformRepository
      ↓
Platform DB access
```

Recommended production approach:

```text
DATABASE_PLATFORM_URL
```

using a restricted PostgreSQL role:

```text
vautrin_platform_admin
```

This role SHOULD receive only required table privileges.

For RLS-protected tenant tables, define explicit admin-role policies where needed.

Avoid a broad database `BYPASSRLS` role if narrower grants/policies can satisfy V1.

---

## 20. Platform Audit Log

Recommended model:

```prisma
model PlatformAuditLog {
  id             String   @id @default(uuid())

  actorUserId    String
  actorRole      String

  action         String
  targetType     String
  targetId       String?

  tenantId       String?
  reason         String?

  requestId      String?
  correlationId  String?

  metadata       Json?

  createdAt      DateTime @default(now())

  @@index([actorUserId, createdAt])
  @@index([targetType, targetId, createdAt])
  @@index([tenantId, createdAt])
  @@index([createdAt])
}
```

Events:

```text
platform.user.invited
platform.user.updated
platform.user.disabled
platform.user.enabled
platform.user.deleted
platform.membership.created
platform.membership.role_changed
platform.membership.removed
platform.tenant.created
platform.tenant.updated
platform.tenant.suspended
platform.tenant.reactivated
platform.tenant.archived
platform.access.granted
platform.access.changed
platform.access.revoked
```

Audit records SHOULD be append-only.

Do not store secrets or excessive PII in `metadata`.

---

## 21. Admin Audit API

### GET `/api/admin/audit`

Filters:

```text
actorUserId
tenantId
targetType
targetId
action
from
to
cursor
limit
```

Default sort:

```text
createdAt desc
```

---

## 22. Frontend Application

Create:

```text
apps/admin/
```

Suggested structure:

```text
apps/admin/
├── app.vue
├── pages/
│   ├── login.vue
│   ├── dashboard.vue
│   ├── users/
│   │   ├── index.vue
│   │   └── [id].vue
│   ├── tenants/
│   │   ├── index.vue
│   │   └── [id].vue
│   └── audit.vue
├── components/
│   ├── admin/
│   ├── users/
│   ├── tenants/
│   ├── charts/
│   └── shared/
├── composables/
├── middleware/
├── services/
└── types/
```

Frontend middleware is not an authorization boundary. The API remains authoritative.

---

## 23. Navigation

V1 sidebar:

```text
VAUTRIN
Platform Admin

Overview
Users
Tenants
Audit Log
```

The admin UI SHOULD look visibly different from tenant UI to reduce operator mistakes.

---

## 24. Dashboard UI

Hierarchy:

```text
Platform Overview
        │
        ├── Summary metrics
        ├── User registrations — 12 months
        ├── Tenant registrations — 12 months
        └── Recent admin activity
```

Follow the Vautrin design system:

- minimal cards;
- neutral surfaces;
- compact tables;
- strong hierarchy;
- restrained accent color;
- explicit destructive states.

---

## 25. Users List UI

Columns:

```text
User
Email
Status
Tenants
Created
Last login
Actions
```

Toolbar:

```text
Search
Status
Tenant
Created range
Invite user
```

No bulk delete in V1.

Row actions:

```text
View
Edit
Disable / Enable
Delete
```

---

## 26. User Detail UI

Sections:

```text
Identity
Status
Memberships
Security/session summary
Recent platform audit activity
```

Actions:

```text
Edit
Add membership
Change tenant role
Remove membership
Disable
Enable
Delete
```

If the target user has platform access, platform-role editing is SUPER_ADMIN-only.

Protect against:

- deleting the current admin identity;
- removing the last active SUPER_ADMIN.

---

## 27. Tenant List UI

Columns:

```text
Tenant
Status
Users
Vertical
Created
Actions
```

Actions:

```text
View
Edit
Suspend / Reactivate
Archive
```

Primary action:

```text
New tenant
```

---

## 28. Destructive Action UX

### Disable

Confirmation text should explain:

```text
The user will be signed out and unable to log in.
Historical records are preserved.
```

### Delete

Confirmation should explain:

```text
This removes the user from active use, revokes sessions,
deactivates memberships, and preserves historical/audit references.
This is not a permanent data purge.
```

Use typed confirmation for high-risk operations.

---

## 29. API Error Contract

Stable error codes:

```text
PLATFORM_ACCESS_REQUIRED
PLATFORM_PERMISSION_DENIED
USER_NOT_FOUND
USER_ALREADY_DISABLED
USER_ALREADY_DELETED
USER_DELETE_SELF_FORBIDDEN
LAST_SUPER_ADMIN_PROTECTED
TENANT_NOT_FOUND
TENANT_ALREADY_SUSPENDED
TENANT_ALREADY_ARCHIVED
MEMBERSHIP_NOT_FOUND
MEMBERSHIP_ALREADY_EXISTS
INVITATION_ALREADY_PENDING
```

---

## 30. Concurrency and Idempotency

State-changing admin operations SHOULD support idempotency where duplicate requests may duplicate side effects.

At minimum:

```text
tenant creation
invitation creation
membership creation
disable/delete
```

Lifecycle changes MUST validate the current state transactionally.

---

## 31. Performance Targets

Initial service targets:

```text
dashboard summary p95 < 500 ms
12-month analytics p95 < 800 ms
paginated list p95 < 500 ms
detail API p95 < 500 ms
```

Avoid N+1 membership queries.

---

## 32. Pagination

All unbounded admin lists MUST be paginated.

```text
default page size = 25
maximum = 100
```

Use cursor pagination where consistent with existing APIs.

---

## 33. Observability

Capture:

```text
request_id
correlation_id
platform_actor_user_id
platform_role
operation
target_type
target_id
tenant_id when applicable
duration_ms
outcome
error_code
```

Never log passwords, tokens, provider credentials, or session cookies.

Important security events:

```text
repeated admin login failures
platform-access changes
user deletion
tenant suspension
admin authorization failures
last-super-admin protection events
```

---

## 34. Testing Requirements

### Unit

- permission matrix;
- analytics aggregation and zero-month filling;
- user lifecycle;
- tenant lifecycle;
- membership changes;
- delete-self protection;
- last-super-admin protection;
- audit creation.

### API integration

Verify:

```text
normal user cannot access /api/admin
tenant OWNER cannot access /api/admin
read-only admin cannot mutate
operator can create tenant
operator can invite owner
operator can manage memberships
operator can disable user
super admin can logically delete user
disable/delete revokes sessions
deleted user cannot authenticate
```

### DB security

Verify:

- normal tenant DB role cannot perform platform-wide queries;
- platform DB role has only expected access;
- admin APIs do not expose credentials/secrets;
- normal RLS behavior remains unchanged.

### Frontend

Verify:

- admin auth guard;
- dashboard loading/error/empty states;
- user and tenant search/filter/pagination;
- permission-aware actions;
- destructive confirmation;
- responsive behavior.

### E2E

```text
SUPER_ADMIN login
        ↓
create tenant
        ↓
invite OWNER
        ↓
OWNER accepts
        ↓
dashboard counts update
        ↓
modify membership
        ↓
disable user
        ↓
session revoked
        ↓
re-enable
        ↓
logical delete
        ↓
audit visible
```

---

## 35. Migrations

Expected changes:

```text
PlatformAccess
PlatformAuditLog
User lifecycle fields if absent
Tenant lifecycle fields if absent
indexes
platform DB grants/RLS policies
```

---

## 36. Deployment

Admin frontend:

```text
Nuxt static build
    ↓
dedicated GCS bucket
    ↓
Cloud CDN
    ↓
admin.${BASE_DOMAIN}
```

Backend:

```text
same NestJS API
+
AdminModule
```

Potential config:

```text
ADMIN_BASE_URL
DATABASE_PLATFORM_URL
```

---

## 37. Rollout Plan

### Phase 1 — Security/domain

- PlatformAccess;
- permission guards;
- admin session/audience;
- PlatformRepository;
- audit;
- lifecycle fields.

### Phase 2 — Read-only admin

- `apps/admin`;
- login;
- dashboard;
- users;
- tenants;
- audit.

### Phase 3 — Mutations

- create tenant;
- invite user;
- edit user;
- membership management;
- disable/enable;
- suspend/reactivate/archive.

### Phase 4 — Destructive lifecycle

- logical delete;
- last-super-admin protection;
- stronger confirmations;
- E2E security verification.

### Phase 5 — Hardening

- GCP deployment;
- logging/metrics;
- alerting;
- runbook;
- backup/restore validation.

---

## 38. Acceptance Criteria

- [ ] `admin.${BASE_DOMAIN}` is separately deployed.
- [ ] Only active platform-authorized users can access it.
- [ ] Tenant OWNER/ADMIN does not grant platform access.
- [ ] Dashboard displays total users/tenants and active counts.
- [ ] Dashboard displays user registrations by month for the last 12 months.
- [ ] Admin can search/inspect users.
- [ ] Admin can search/inspect tenants.
- [ ] Admin can create a tenant.
- [ ] Admin can invite/register a user into a tenant.
- [ ] Admin can modify membership and tenant role.
- [ ] Admin can disable/re-enable users.
- [ ] Authorized admin can logically delete a user.
- [ ] Disable/delete revokes sessions.
- [ ] Admin can suspend/reactivate/archive tenants.
- [ ] Every mutation produces an immutable platform audit record.
- [ ] Normal tenant RLS/API behavior is unchanged.
- [ ] Admin APIs never expose secret/token material.
- [ ] Staging E2E passes.
- [ ] UI follows the Vautrin design system.

---

## 39. Definition of Done

V1 is done when a Vautrin operator can manage customer identity and tenant lifecycle from the Admin Console without direct DB modification:

```text
admin.${BASE_DOMAIN}
        ↓
platform login
        ↓
view platform dashboard
        ↓
create tenant
        ↓
invite owner
        ↓
manage memberships
        ↓
disable/reactivate
        ↓
logical delete when authorized
        ↓
inspect full audit history
```

All operations must be permissioned, tenant-safe, auditable, and reversible where the lifecycle permits.
