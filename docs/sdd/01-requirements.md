# SDD-01 — Requirements

## 1. Functional requirements

### FR-001 Tenant management
The system shall support multiple independent businesses.

### FR-002 User membership
A user may belong to one or more tenants subject to authorization rules.

### FR-003 Business configuration
Each tenant shall configure:
- business name;
- locations;
- service areas;
- services;
- business hours;
- communication preferences;
- qualification rules;
- booking rules;
- AI configuration.

### FR-004 Contacts
Users shall create, view, update, search, and paginate contacts.

### FR-005 Leads
Users shall create and manage leads with lifecycle status, source,
service, assigned user, and custom fields.

### FR-006 Conversations
The system shall represent customer conversations independently of channel.

### FR-007 Messages
Messages shall record direction, channel, status, timestamps, and provider metadata.

### FR-008 AI reception
The AI receptionist shall:
- understand basic customer intent;
- answer grounded business questions;
- collect lead information;
- create/update leads;
- qualify leads;
- attempt appointment booking;
- escalate when required.

### FR-009 Appointments
The system shall expose availability and create/cancel appointments through a provider abstraction.

### FR-010 Estimates
The system shall track estimate creation, sending, status, and follow-up state.

### FR-011 Workflows
The system shall execute event-triggered workflows with conditions, waits, actions, retries, and failure handling.

### FR-012 Knowledge
The system shall support tenant-specific unstructured knowledge and semantic retrieval.

### FR-013 Audit
Important state changes and external actions shall be auditable.

## 2. Non-functional requirements

### NFR-001 Tenant isolation
No tenant may access another tenant's data.

### NFR-002 Reliability
External side effects should be retryable and idempotent where practical.

### NFR-003 Performance
Normal dashboard/API operations should be responsive enough for interactive use;
long-running operations must not block HTTP requests.

### NFR-004 Security
Secrets, credentials, and sensitive data must be protected.

### NFR-005 Observability
The platform shall provide structured logs and correlation identifiers.

### NFR-006 Testability
Domain behavior and critical workflows must be testable without real external providers.

### NFR-007 Extensibility
Adding a new vertical should primarily require configuration/templates.

## 3. Initial user roles

- Owner
- Admin
- Manager
- Staff
- Read-only

Agent execution is not treated as a human role.

## 4. Initial lead statuses

```text
NEW
CONTACTED
QUALIFIED
APPOINTMENT_BOOKED
ESTIMATE_PENDING
ESTIMATE_SENT
FOLLOW_UP
WON
LOST
```

The status model must remain configurable enough to support future verticals.

## 5. Critical user stories

### US-001
As a contractor owner, I can see all new leads in one pipeline.

### US-002
As a contractor owner, I can configure services and service areas.

### US-003
As a customer, I can receive a fast response after contacting the business.

### US-004
As a business, I can have AI collect qualification information.

### US-005
As a business, I can have AI offer available appointment times.

### US-006
As a business, I can automatically follow up with leads who do not respond.

### US-007
As a business, I can track estimates awaiting customer response.

### US-008
As an administrator, I can inspect AI actions and workflow executions.

## 6. Acceptance baseline

A release candidate must demonstrate the complete critical path:

```text
Inbound event
 -> tenant resolution
 -> contact
 -> lead
 -> conversation
 -> AI/tool execution
 -> follow-up
 -> appointment
 -> estimate
 -> estimate follow-up
 -> audit
```
