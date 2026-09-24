# SDD-04 — Database Specification

## 1. PostgreSQL

PostgreSQL is the source of truth for durable business state.

## 2. Required extension

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

The exact embedding dimensions are provider/model configuration and must not be
hardcoded into unrelated domain code.

## 3. Initial tables

```text
tenants
users
tenant_users
refresh_tokens
business_profiles
locations

contacts
leads
lead_sources

conversations
messages
calls

appointments
estimates

workflows
workflow_runs
workflow_step_runs

agents
agent_runs
tool_executions

knowledge_documents
knowledge_chunks

integrations
events
audit_logs

custom_field_definitions
custom_field_values
```

### Global tables

`users` and `refresh_tokens` are not tenant-scoped. Both describe a person
rather than a tenant's data, and both must be readable before an active
tenant is known — authentication looks a user up by email, and a refresh
token is redeemed before any tenant is selected. Neither carries `tenant_id`
and neither has an RLS policy (ADR-013).

Tenant-scoped access to people goes through `tenant_users`, which is
protected.

V0.3 adds nullable `provider_event_id`, `correlation_id`, and
`idempotency_key` to `messages`. Unique tenant/provider/event and
tenant/idempotency indexes form the webhook/outbound deduplication boundary;
provider message IDs remain separately unique. The provider ingestion path
must still validate signatures and resolve a tenant before any write.

Outbox discovery uses a SECURITY DEFINER function returning only pending
tenant IDs and oldest timestamps. Actual event reads/claims/updates stay
inside transaction-local tenant RLS context; the normal runtime role cannot
query another tenant's event rows.

The tenant-scoped `contact_channel_preferences` table records per-contact,
per-channel opt-out timestamps and their source. It has FORCE RLS and a unique
tenant/contact/channel key. It is a technical send-suppression boundary, not
a complete legal consent policy.

## 4. Common columns

Tenant-scoped tables should normally contain:

```text
id
tenant_id
created_at
updated_at
```

Where useful:

```text
deleted_at
created_by
updated_by
version
```

## 5. IDs

Use UUID/UUIDv7-style IDs.

IDs exposed through APIs must not reveal tenant sequencing.

## 6. Indexing baseline

Every tenant-scoped high-volume table should have an index beginning with
`tenant_id` where queries commonly filter by tenant.

Examples:

```text
leads(tenant_id, status)
leads(tenant_id, created_at)
contacts(tenant_id, phone)
conversations(tenant_id, updated_at)
appointments(tenant_id, starts_at)
workflow_runs(tenant_id, status)
audit_logs(tenant_id, created_at)
```

Exact indexes must be validated against query plans.

## 7. JSONB

Use JSONB for:
- flexible integration metadata;
- workflow configuration;
- provider-specific metadata;
- tenant configuration that is intentionally schema-flexible.

Do not use JSONB to avoid modeling stable business concepts.

## 8. Vector storage

`knowledge_chunks` should contain:

```text
id
tenant_id
document_id
content
embedding
metadata
created_at
```

Metadata can include:
- document type;
- service;
- location;
- source;
- version.

## 9. Transactions

Use transactions for state transitions that must remain atomic.

Examples:
- create lead + initial event;
- create appointment + update lead status;
- workflow state + event emission.

For cross-system side effects, use an outbox-style pattern when required rather
than pretending the external provider participates in the database transaction.

## 10. Migrations

Production uses:

```text
prisma migrate deploy
```

Never use:

```text
prisma db push
```

against production.

## 11. Backup/recovery

The production database must have:
- automated backups;
- restore procedure;
- tested recovery process;
- documented retention policy.

Exact infrastructure values are environment decisions, not hardcoded in the domain.

## V0.2 Addendum - Schema reconciliation

The V0.1 table inventory is no longer an exact closed list. ADR-approved schema evolution is allowed when the SDD is updated in the same change.

Additional approved tables:

```text
refresh_tokens
services
service_areas
```

`refresh_tokens` is global. `services` and `service_areas` are tenant-scoped and MUST receive ENABLE + FORCE RLS and isolation tests.

The reviewed V0.2 snapshot contained six migrations; subsequent approved schema changes must not hardcode migration counts as completion evidence.
