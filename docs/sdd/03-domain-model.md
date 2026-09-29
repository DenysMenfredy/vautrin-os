# SDD-03 — Domain Model

## 1. Core entities

### Tenant
The security and billing boundary for a business account.

### User
A human identity.

### TenantUser
Membership connecting a user to a tenant and role.

### TenantInvitation
A tenant-scoped, expiring, one-time invitation to join a tenant. It stores an
email, role, and token digest, not a usable bearer token. Acceptance creates or
activates a user and membership; an existing user proves identity with their
current password. The operator issues the first owner invitation, and active
members with `member.manage` issue subsequent invitations.

### BusinessProfile
Business-specific operational configuration.
The API exposes communication preferences, qualification rules, booking rules,
and AI configuration through a `business.manage`-restricted settings resource.
They remain flexible JSON objects until a versioned configuration schema is
specified; the ordinary business-profile response omits AI configuration.

### Location
Physical/service location associated with a tenant.

### Contact
A person or organization interacting with the business.
`ContactChannelPreference` records technical opt-outs by channel; the
inbound STOP command is handled deterministically before AI interpretation.

### Lead
A sales opportunity associated with a contact.

### Conversation
A channel-independent interaction thread.

### Message
An inbound/outbound communication item.

### Call
A telephony interaction and its metadata/transcript reference.

### Appointment
A scheduled customer interaction.

### Estimate
A sales estimate and its lifecycle.

### Workflow
A declarative automation definition.

### WorkflowRun
One execution instance of a workflow.

### WorkflowStepRun
Execution state for an individual workflow step.

### Agent
An AI capability definition.

### AgentRun
One execution of an AI agent.

### ToolExecution
One invocation of an agent tool.

### KnowledgeDocument
A tenant-owned source document.

### KnowledgeChunk
An embedded semantic chunk of a knowledge document.

### Integration
Connection metadata for an external provider.

### Event
A durable business event emitted by the platform.

### AuditLog
A security/operations record of important actions.

## 2. Relationship model

```text
Tenant
 ├── TenantUser ── User
 ├── TenantInvitation
 ├── BusinessProfile
 ├── Location
 ├── Service
 ├── ServiceArea
 ├── Contact
 │    └── Lead
 │         ├── Conversation
 │         │    └── Message
 │         ├── Call
 │         ├── Appointment
 │         └── Estimate
 ├── Workflow
 │    └── WorkflowRun
 │         └── WorkflowStepRun
 ├── Agent
 │    └── AgentRun
 │         └── ToolExecution
 ├── KnowledgeDocument
 │    └── KnowledgeChunk
 ├── Integration
 └── AuditLog
```

## 3. Tenant-scoped rule

All entities except global catalog/configuration entities are tenant-scoped.

Every tenant-scoped entity must contain `tenant_id`.

## 4. Lifecycle state

Lead lifecycle is a business concept, not an AI concept.

AI may recommend or perform transitions through tools, but the domain owns
the valid state transitions.

For the initial status set in SDD-01 §4, a lead may move forward to any later
listed stage; it may close as WON or LOST, and either closed state is terminal.
Changing status uses the lead's current `version` so simultaneous human and AI
updates cannot silently overwrite one another. Source IDs and requested
service keys must resolve to active records in the same tenant when selected;
the lead keeps its service-key snapshot after catalog changes.

## 5. Custom fields

Vertical-specific attributes are represented using:
- `CustomFieldDefinition`
- `CustomFieldValue`

Do not add vertical-specific columns to core entities unless the field becomes
a universal concept.

## 6. Vertical templates

Templates provide:
- services;
- custom fields;
- qualification questions;
- default workflows;
- prompt/context configuration;
- dashboard configuration.

Templates must not fork the core domain model.

## V0.2 Addendum - Authentication session entity

Add `RefreshToken` as a global identity/session entity. It is not tenant-scoped because it authenticates a user before an active tenant is necessarily selected.

Required fields include `user_id`, token digest, family identifier, replacement/revocation metadata, expiry, diagnostics, and `active_tenant_id` (nullable). `active_tenant_id` is a session preference and MUST be revalidated against active membership before use.

Add tenant-scoped `Service` and `ServiceArea` entities before VOS-042/VOS-043. Vertical templates seed these records; they do not fork the core schema.
