# SDD-03 — Domain Model

## 1. Core entities

### Tenant
The security and billing boundary for a business account.

### User
A human identity.

### TenantUser
Membership connecting a user to a tenant and role.

### BusinessProfile
Business-specific operational configuration.

### Location
Physical/service location associated with a tenant.

### Contact
A person or organization interacting with the business.

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
 ├── BusinessProfile
 ├── Location
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
