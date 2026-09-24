# Vautrin OS — Implementation Specification v0.3

**Date:** 2026-09-23  
**Target:** First 10 paying customers  
**Vertical:** Remodeling / Home Services  
**Architecture:** Modular monolith + independent worker  
**Production cloud:** Google Cloud Platform  
**Async execution:** Redis + BullMQ

## 1. Purpose

V0.3 moves Vautrin from a secure multi-tenant CRM/configuration core to the first commercially useful revenue workflow. The milestone is not “complete Vautrin OS.” It is a production-capable slice that can capture a contractor lead, communicate with it, qualify it, book an appointment, perform delayed follow-up, and prove what the system did.

The implementation must optimize for the first 10 customers. Infrastructure or abstractions that do not reduce customer onboarding risk, increase reliability, or enable the revenue workflow are deferred.

## 2. Repository review — v0.2 baseline

The uploaded v0.2 repository materially advances the previous review pack. Static inspection confirms the following foundation is represented as implemented in the repository/backlog:

- pnpm/Turborepo monorepo and strict TypeScript standards;
- Nuxt 4 web application;
- NestJS API and standalone worker;
- PostgreSQL + pgvector and Prisma migrations;
- Redis/BullMQ shared package and four registered queues;
- CI/security/integration-test infrastructure;
- JWT access + rotating opaque refresh sessions;
- atomic refresh-token rotation;
- active-tenant continuity across refresh;
- membership revocation with session invalidation;
- auth abuse controls and origin/proxy contract;
- pooled multi-tenancy with FORCE RLS and isolation tests;
- business profile, locations, services, service areas and business configuration;
- custom-field definitions/values;
- contacts, leads, lead sources, lead lifecycle, assignment and CRM counts;
- versioned durable `Event` outbox model;
- audit coverage for authentication/authorization and implemented business/CRM mutations.

The repository explicitly states that queue registration is not yet event dispatch/workflow execution, and that conversations, messaging, AI, booking, estimates and the full workflow engine remain incomplete. V0.3 starts from that boundary.

### Review observations to fix while entering v0.3

1. `infra/README.md` contains stale text saying `apps/web` has no image/application, while the repository now contains `apps/web` and its Dockerfile. Reconcile documentation before using it as deployment guidance.
2. The current production-oriented web container uses Nitro as a same-origin `/api` proxy. The chosen GCP production architecture uses a static Nuxt build on GCS. Production must therefore preserve same-origin `/api/*` routing at the external load balancer rather than depending on Nitro.
3. V0.2's `Event.publishedAt` outbox model is sufficient for the next slice, but dispatch claiming/concurrency semantics must be explicit before multiple dispatcher instances exist.
4. `VOS-121` remains IN_PROGRESS until workflow, agent/tool and integration side effects are audited.

### Verification limitation

This review is based on static inspection of the uploaded source. The execution environment did not provide the repository's pinned pnpm toolchain, so this review does not independently claim that lint, typecheck, tests or builds are green. Existing CI/test definitions are evidence of intended verification, not a substitute for a fresh successful run.

## 3. V0.3 product outcome

The v0.3 release candidate must demonstrate this end-to-end path:

```text
Inbound lead / missed-call signal
  -> Contact resolved or created
  -> Lead resolved or created
  -> Conversation created
  -> First outbound response queued
  -> Message sent through provider
  -> Customer reply ingested and deduplicated
  -> AI qualifies using tenant business configuration
  -> Lead state updated
  -> Availability checked
  -> Appointment booked
  -> Delayed follow-up scheduled when required
  -> Audit + operational metrics updated
  -> Dashboard can explain the outcome
```

The missed-call telephony trigger may use a provider webhook or a controlled test adapter initially. Do not block the revenue slice on a full AI voice implementation.

## 4. Frozen V0.3 architecture decisions

### 4.1 Runtime

- `apps/web`: Nuxt 4 static production output.
- `apps/api`: NestJS HTTP system-of-record API.
- `apps/worker`: NestJS standalone BullMQ processor.
- PostgreSQL/Cloud SQL: authoritative state + pgvector + RLS.
- Redis/BullMQ: asynchronous/delayed execution.
- GCS + Cloud CDN: production frontend assets.
- GCP External HTTPS Load Balancer: TLS and same-origin path routing.
- Compute Engine: API and worker compute for first-customer scale; MIGs when redundancy/autoscaling is justified.
- Artifact Registry: API/worker/migration images.
- Secret Manager: production secrets.
- Terraform: production infrastructure.

### 4.2 Explicit non-decisions

Do not introduce in v0.3:

- Pub/Sub;
- Cloud Tasks;
- GKE/Kubernetes;
- microservices;
- Kafka;
- multi-region database;
- custom/fine-tuned LLMs;
- AI voice as a dependency for MVP completion;
- project management/accounting/payments;
- generalized workflow-builder UI.

## 5. Workstream A — Durable event dispatch

**Goal:** connect the already persisted `events` outbox to BullMQ safely.

### A1. Event dispatcher

Implement a dispatcher that finds unpublished `Event` rows and enqueues `DurableEventJob` to the `workflow` queue.

Required behavior:

- bounded batches;
- oldest-first processing;
- safe concurrent claiming or a single-dispatcher invariant that is enforced operationally;
- queue payload contains `eventId`, `tenantId`, `correlationId`, actor metadata where available and idempotency metadata;
- `publishedAt` is set only after successful enqueue;
- crash between enqueue and `publishedAt` is safe because downstream processing is idempotent;
- dispatcher metrics: scanned, enqueued, duplicate/replayed, failed, oldest-unpublished age.

Do not attempt distributed exactly-once delivery.

### A2. Event consumer/idempotency

Implement durable processing identity for each logical consumer. A retry or duplicate event must not produce duplicate business side effects.

Acceptance:

- same event delivered twice does not create two workflow runs for the same workflow/version;
- same external side effect uses a stable idempotency key;
- tenant context is established before any tenant query;
- failed jobs are visible and retry according to bounded policy.

### A3. Reconciliation

Add a recovery operation/job that finds stale unpublished events and retries dispatch. Later workflow reconciliation must be able to identify pending scheduled work from PostgreSQL state.

## 6. Workstream B — Conversations and messaging (VOS-060–065)

### B1. Conversation and Message domain

Use the existing schema where possible; do not create channel-specific conversation models.

Conversation requirements:

- tenant/contact/lead association;
- channel;
- status;
- assigned user/agent where applicable;
- timestamps and last activity;
- tenant-scoped queries and RLS.

Message requirements:

- inbound/outbound direction;
- provider and provider message ID;
- delivery status;
- normalized sender/recipient;
- body/content metadata;
- correlation/idempotency metadata;
- failure metadata without secrets;
- uniqueness preventing duplicate provider webhook ingestion.

### B2. Messaging provider port

Create a provider-neutral interface in `packages/integrations` or another approved integration boundary. Business modules must not import a vendor SDK directly.

Minimum capabilities:

- send text message;
- normalize provider result;
- validate inbound webhook signature;
- normalize inbound webhook event;
- expose stable provider event/message IDs.

Implement one production provider adapter only.

### B3. Webhook ingestion

Webhook endpoint must:

1. validate provider authenticity before trusting payload;
2. resolve tenant from provisioned integration/phone identity, never arbitrary tenant input;
3. deduplicate provider event ID;
4. persist inbound message/conversation update transactionally;
5. create durable domain event in same transaction;
6. acknowledge provider within its timeout expectations;
7. move expensive AI/workflow work to BullMQ.

### B4. Communication safety baseline

Persist the minimum communication preference/consent state needed to suppress messages when a contact has opted out. STOP/opt-out handling must bypass AI interpretation where provider semantics are deterministic.

Detailed U.S. legal/compliance policy is a separate reviewed requirement; v0.3 must at least provide the technical suppression mechanism and audit trail.

## 7. Workstream C — Workflow execution core (VOS-081–089)

V0.3 does not need a visual workflow builder. Definitions may be seeded/configured data.

### C1. Workflow definitions

Support versioned definitions with:

- trigger event;
- active/inactive state;
- ordered steps;
- conditions;
- action configuration;
- immutable version reference for a running workflow.

### C2. Workflow runs

`WorkflowRun`/step state in PostgreSQL is authoritative.

Required states should distinguish at least pending/running/waiting/completed/failed/cancelled where supported by the existing schema.

### C3. Initial step types

Implement only what the first revenue workflow needs:

- condition;
- wait;
- send_message;
- call_agent;
- create/update lead as a typed tool/action if needed;
- booking action once Workstream E lands;
- human_handoff.

### C4. Wait semantics

A wait step writes durable state first, then schedules a delayed BullMQ job. On wake-up the worker reloads the workflow run and verifies that the step is still actionable before executing.

Never put the only copy of future workflow intent in Redis.

### C5. Failure policy

- transient provider/network errors: bounded retry/backoff;
- invalid business configuration: fail step with actionable reason;
- unsafe/unauthorized AI action: reject + audit + handoff where appropriate;
- exhausted retry: failed workflow/step visible operationally;
- poison jobs never loop indefinitely.

## 8. Workstream D — AI foundation (VOS-070–078)

### D1. LLM provider abstraction

Implement a provider-neutral `LLMProvider` with the minimum capabilities required by the receptionist. Avoid premature multi-provider feature parity.

Record per run:

- provider;
- model;
- prompt/config version;
- latency;
- input/output/cached tokens when available;
- estimated provider cost when pricing metadata exists;
- structured result/error;
- tool calls;
- correlation/tenant/run IDs.

### D2. Agent configuration

The receptionist agent is configuration over a shared runtime, not a new service.

Agent execution receives:

- system/policy instructions;
- tenant business profile;
- services/service areas/hours;
- qualification rules;
- conversation context;
- relevant lead/contact context;
- optional retrieved knowledge;
- explicitly authorized tools.

### D3. Tool framework

Tools are typed application capabilities. The LLM never receives raw SQL/database access.

Every tool defines:

- input schema;
- output schema;
- required capability/policy;
- tenant context;
- validation;
- idempotency behavior if side-effecting;
- audit behavior;
- whether human approval is required.

### D4. Structured before semantic

Services, hours, service area, lead state, qualification rules and availability come from structured application data. Do not use vector retrieval for facts already modeled in PostgreSQL.

Knowledge/RAG can follow after the core receptionist works; VOS-075–077 should not block first message qualification unless a design-partner requirement proves it necessary.

## 9. Workstream E — Appointment booking (VOS-090–094)

Implement a `CalendarProvider` port and one adapter.

Booking flow:

1. determine tenant/location/service booking rules;
2. query availability through provider adapter;
3. present/choose allowed slot;
4. create appointment using idempotency protection;
5. persist local appointment state;
6. emit `appointment.created`;
7. audit the action.

External calendar remains an integration; Vautrin retains enough local state to explain what it booked and correlate later provider events.

## 10. Workstream F — Receptionist vertical slice (VOS-100–104)

### F1. Initial responsibilities

The receptionist may:

- answer supported business questions from grounded context;
- capture/update lead information;
- ask qualification questions;
- determine whether the lead matches configured service/service area rules;
- schedule an allowed appointment;
- send permitted follow-up messages;
- hand off to a human.

It may not:

- invent pricing/availability;
- override qualification/business rules;
- make financial commitments;
- delete customer records;
- bypass communication suppression;
- access another tenant.

### F2. First production workflow

Implement `missed_call_recovery_v1`:

```text
call.missed
  -> resolve/create contact
  -> resolve/create lead
  -> create/open conversation
  -> wait configurable short delay
  -> generate grounded recovery message
  -> validate communication policy
  -> send SMS
  -> wait for response
  -> on response: qualify
  -> if qualified: offer/book appointment
  -> if no response: bounded follow-up sequence
  -> handoff on unsupported/unsafe path
```

The exact follow-up cadence belongs in tenant/template configuration, not hardcoded vertical logic.

### F3. Evaluation set

Before customer #1, maintain a small versioned eval set covering at least:

- valid remodeling lead;
- outside service area;
- unsupported service;
- ambiguous budget/timeline;
- request for unavailable time;
- opt-out;
- prompt-injection attempt;
- request for human;
- provider failure;
- duplicate inbound message.

Evaluate correctness of structured decisions/tool calls, not prose style alone.

## 11. Workstream G — Remodeling template

Seed a first usable design-partner template:

Services:

- Kitchen Remodeling;
- Bathroom Remodeling;
- Whole Home Remodeling;
- Basement Remodeling;
- Home Additions.

Qualification baseline:

- project type;
- property type;
- service location;
- budget range;
- desired timeline;
- project description.

Template installs configuration; it must not fork the core schema or business services.

## 12. Workstream H — GCP deployment

Implement SDD-12 v0.3 and ADR-009 revision included with this package.

### H1. Static web

- make Nuxt production build static/GCS compatible;
- remove production dependence on Nitro proxy;
- route `/api/*` at GCP load balancer to API;
- route remaining app/static paths to backend bucket/CDN;
- test deep links and auth refresh cookies through the real topology.

### H2. Compute

- API and worker Docker images in Artifact Registry;
- Compute Engine startup/deployment mechanism documented;
- separate service accounts;
- graceful rollout;
- API publicly reachable only through intended ingress;
- worker has no public application ingress.

### H3. Data services

- Cloud SQL PostgreSQL + pgvector;
- automated backups + PITR;
- production Redis for BullMQ;
- private networking where practical;
- Secret Manager.

### H4. Terraform

Create minimal modules for network, load balancer/GCS, compute, Cloud SQL, Redis, Artifact Registry, IAM/secrets and monitoring. Do not create GKE.

## 13. Observability and unit economics

V0.3 should start collecting cost-relevant usage even if billing is flat-rate.

Per tenant track where available:

- LLM input/output/cached tokens;
- LLM/provider/model;
- agent runs;
- tool calls;
- SMS inbound/outbound segments/messages;
- workflow runs/steps/retries;
- provider failures;
- appointments booked;
- leads created/qualified;
- response time;
- missed-call recoveries.

Do not expose speculative “revenue generated” as fact. If revenue influenced is shown later, methodology must be explicit and traceable.

## 14. Security/audit delta

Extend VOS-121 audit coverage to:

- integration credential/config changes;
- outbound message side effects;
- workflow activation/version changes;
- agent tool executions;
- human approvals/handoffs;
- appointment creation/cancellation;
- provider webhook security failures where useful.

Never audit raw secrets, auth tokens, full provider credentials or unnecessary sensitive message payloads.

## 15. Testing strategy

### Required integration tests

- event outbox -> BullMQ dispatch;
- duplicate dispatch/idempotent consumer;
- worker tenant RLS context;
- conversation/message tenant isolation;
- provider webhook signature rejection;
- duplicate webhook event suppression;
- outbound message retry/idempotency;
- delayed workflow wake-up;
- workflow cancellation before delayed wake-up;
- AI tool authorization;
- booking idempotency;
- provider failure and retry exhaustion.

### Critical E2E

The v0.3 release gate is a deterministic/provider-mocked E2E covering:

```text
missed call/event
 -> lead/contact
 -> conversation
 -> recovery message
 -> inbound reply
 -> qualification
 -> booking
 -> CRM state
 -> audit/telemetry
```

A separate staging smoke test should exercise the real configured messaging/calendar provider with a controlled test identity before onboarding a customer.

## 16. Implementation order — recommended PR sequence

1. **V0.3 docs reconciliation** — ADR-009, SDD-12, stale infra README, backlog status.
2. **Outbox dispatcher** — Event -> BullMQ with metrics and concurrency-safe semantics.
3. **Idempotent event consumer foundation** — durable consumer identity and retry/failure visibility.
4. **Conversation + Message domain/API**.
5. **MessagingProvider + first adapter**.
6. **Inbound webhook validation/deduplication**.
7. **Outbound messaging worker + communication suppression**.
8. **Workflow definition/run core**.
9. **Wait/condition/send-message workflow steps**.
10. **LLMProvider + first adapter + telemetry**.
11. **Agent runtime + typed tool framework + business context**.
12. **CalendarProvider + appointment booking**.
13. **Receptionist agent + qualification tools + human handoff**.
14. **`missed_call_recovery_v1` workflow**.
15. **Remodeling template/eval set**.
16. **Critical-path E2E**.
17. **GCP Terraform + staging deployment**.
18. **Production-readiness drill and first design-partner onboarding**.

PRs may be split further. Avoid combining schema, provider, workflow and UI changes into one large PR.

## 17. V0.3 exit criteria

V0.3 is complete when:

- all v0.2 security gates remain green;
- durable events reliably reach BullMQ processors;
- duplicate delivery does not duplicate customer-facing side effects;
- conversations/messages and one messaging provider work end to end;
- workflow waits/retries are durable and observable;
- receptionist uses grounded tenant configuration and authorized tools;
- one calendar adapter can book an appointment;
- missed-call recovery path passes deterministic E2E;
- remodeling template can onboard a business without engineering/database edits;
- GCP staging reproduces production topology closely enough to test static web + `/api` routing, Cloud SQL and Redis/BullMQ;
- backup/restore and deployment rollback are documented/tested;
- operational dashboard/logs can answer what happened to a lead and why;
- a first design-partner tenant can run the revenue workflow without manual database intervention.

## 18. First-10-customer rule

For every proposed v0.3 addition ask:

> Does this materially help us acquire, onboard, operate, protect, or prove value for one of the first 10 paying customers?

If not, defer it unless it closes a security/reliability defect in the critical path.
