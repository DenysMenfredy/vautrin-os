# ADR-011 — Authentication and RBAC

- Status: Accepted
- Date: 2026-09-19

## Context

The platform is multi-tenant and will contain sensitive business data.

## Decision

Separate:
- authentication;
- tenant membership;
- authorization.

Initial roles:
- owner;
- admin;
- manager;
- staff;
- read-only.

Permissions are capability-based.

## Consequences

Positive:
- clearer security model;
- easier future role customization;
- agent permissions can reuse capability concepts.

Negative:
- authorization must be checked consistently;
- multiple tenant memberships require explicit active-tenant handling.
