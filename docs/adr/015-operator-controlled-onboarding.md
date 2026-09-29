# ADR-015 — Operator-controlled registration and invitations

- Status: Accepted
- Date: 2026-09-29

## Context

ADR-011 separates global identity, tenant membership, and authorization but
did not choose how a person first acquires an account. The first customers are
operator-onboarded, and the repository has no verified email-delivery provider.
Public tenant signup would therefore create an unreviewed provisioning path.

## Decision

There is no public tenant-registration endpoint. A trusted local operator
command creates a tenant plus a pending owner invitation in one transaction.
It does not set the owner's password. Once an owner is active, a tenant member
with `member.manage` may issue invitations for that active tenant. Only an
owner may invite another owner. The API returns the one-time token only on
issuance; the inviter must deliver it privately. No token is written to a log
or database in plaintext.

Invitation acceptance is public only in the sense that no session exists yet:
it requires a 256-bit bearer token and a password. A new user sets a password;
an existing user confirms their current one without resetting it. The global
user and tenant membership become active atomically with one-time token
consumption and an audit record. Users must be ACTIVE to log in. Revoked,
expired, and redeemed invitations fail identically. Abuse controls limit
attempts by IP and token digest.

The invitation row is tenant-scoped under FORCE RLS. A SECURITY DEFINER
function resolves a valid token digest to a tenant ID only; all subsequent
reads and writes run under transaction-local tenant context. This narrow
pre-tenant discovery is required because an unauthenticated invitee has no
active tenant. It does not authorize arbitrary tenant access.

## Consequences

- Tenant creation remains a trusted operator action, not an API capability.
- The operator must securely deliver the initial owner token and preserve the
  response until delivery; the token cannot be retrieved later. A new invite
  can supersede an old one for an active tenant.
- Manual private delivery is acceptable for the initial customer cohort;
  automated email delivery and address verification require a later decision.
- A pending tenant has no active owner until its owner accepts the invitation.
  Operators can reissue its owner invitation with the trusted local command,
  identified by tenant ID. Reissue is refused after an owner activates.
