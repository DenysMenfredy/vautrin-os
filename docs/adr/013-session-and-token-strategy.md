# ADR-013 — Session and Token Strategy

- Status: Accepted
- Date: 2026-09-19

## Context

ADR-011 separates authentication, tenant membership and authorization, and
SDD-09 §2 requires "short-lived access credentials and a secure
refresh/session mechanism". Neither names a mechanism.

Two properties of this platform constrain the choice:

1. A user may belong to several tenants (FR-002), and ADR-011 notes that
   "multiple tenant memberships require explicit active-tenant handling".
   Whatever carries identity must also carry, or resolve, an active tenant.
2. The data is customer business information under RLS (ADR-005). Losing a
   credential must be recoverable — access has to be revocable without
   waiting for natural expiry.

## Decision

Short-lived **JWT access tokens** plus **rotating opaque refresh tokens**
persisted server-side in PostgreSQL.

### Access token

- JWT, HS256, 15 minute lifetime.
- Claims: `sub` (user id), `tid` (active tenant id), `role`, `jti`, `iat`,
  `exp`.
- Verified from the signature alone — no database round-trip on the hot path.
- Capabilities are **not** embedded. They are derived from `role` at request
  time, so the token stays small and a capability-model change does not
  require reissuing tokens.

### Refresh token

- Opaque, 256 bits of CSPRNG output. Never a JWT: there is nothing to read
  client-side, and opacity keeps it inert if leaked into a log.
- Stored **hashed** (SHA-256) in `refresh_tokens`. A database disclosure
  must not yield usable credentials.
- **Rotated on every use**: redeeming a refresh token issues a new one and
  marks the old one replaced.
- Tokens form a **family** (`family_id`). Redeeming an already-replaced
  token means it was captured, so the entire family is revoked — the
  standard reuse-detection response.

### Tenant switching

`POST /auth/tenant` verifies membership and issues a new access token with a
different `tid`. Because access tokens are short-lived, the stale-tenant
window is bounded by the access token lifetime.

## Consequences

Positive:

- No session lookup on the common path; only refresh touches the database.
- Refresh tokens are revocable individually or per family, so a stolen
  credential can be killed without a global logout.
- Reuse detection gives a signal that a token was captured, not just that
  one expired.
- Sessions survive a Redis restart: Redis stays a queue backend and holds no
  durable business state (AGENTS.md §2.8).

Negative:

- `role` and `tid` in the access token can be up to 15 minutes stale. A role
  downgrade or a membership revocation is not instant. Accepted: the window
  is bounded and short, and the alternative is a database read per request.
  Operations needing immediate effect must revoke the refresh family **and**
  wait out the access token, or check membership explicitly.
- A signing secret must be managed (SDD-09 §7).
- Requires a table that SDD-04 §3 did not list — see below.

## Schema change

This decision adds one table, `refresh_tokens`, to the set fixed by
SDD-04 §3. It is a global, user-scoped table like `users`: it carries no
`tenant_id` and no RLS policy, because a refresh token authenticates a
person, not a tenant session, and it must be readable before any tenant is
known. SDD-04 and SDD-09 are updated accordingly.

## Rejected alternatives

### Opaque sessions in Redis

Rejected because Redis is the queue backend and AGENTS.md §2.8 is explicit
that it "is for asynchronous work, not durable business state". A Redis
flush would log out every user, and session records would become state that
matters living in a store treated as disposable.

### JWT access + JWT refresh

Rejected because a self-contained refresh token cannot be revoked without a
denylist, which reintroduces the server-side lookup while losing the ability
to detect reuse.

### Long-lived JWT only

Rejected: no revocation path at all.
