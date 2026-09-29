# Vautrin OS — Technical Backlog v0.2

## Backlog rules

Priority:
- P0 = blocks MVP / security / architecture
- P1 = required for first production vertical slice
- P2 = useful MVP enhancement
- P3 = post-MVP

Status:
- TODO
- IN_PROGRESS
- BLOCKED
- DONE

Each task should be implemented as a small PR where practical.

---

## EPIC E0 — Repository and developer experience

### VOS-001 [P0] Initialize pnpm workspace
**Status:** DONE — pnpm workspace, pinned pnpm 9.15.4 + Node 22.19.0, clean install verified.
**Acceptance criteria**
- root package.json exists;
- pnpm-workspace.yaml exists;
- package manager version is pinned;
- Node version is pinned;
- install works from a clean checkout.

### VOS-002 [P0] Configure Turborepo
**Status:** DONE — turbo.json defines dev/build/lint/typecheck/test with explicit dependsOn.
**Acceptance criteria**
- `dev`, `build`, `lint`, `typecheck`, `test` tasks are defined;
- task dependencies are explicit;
- affected tasks can be run locally.

### VOS-003 [P0] Create apps/web
**Status:** DONE — Nuxt 4.5 + Vue 3 + TypeScript (strict), Nuxt 4 `app/` layout, runtime-config API base, same-origin Nitro proxy to apps/api, status page consuming @vautrin/contracts, component tests via @nuxt/test-utils.
Nuxt 4 + Vue 3 + TypeScript.

### VOS-004 [P0] Create apps/api
**Status:** DONE — NestJS 12 (ESM) HTTP app: validated environment, global ValidationPipe, consistent error filter, OpenAPI, liveness/readiness probes, graceful shutdown.
NestJS application.

### VOS-005 [P0] Create apps/worker
**Status:** DONE — NestJS 12 standalone context consuming the four ADR-009 BullMQ queues with bounded retries and job-scoped tenant context.
NestJS worker application.

### VOS-006 [P0] Configure shared TypeScript standards
**Status:** DONE — tsconfig.base.json (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes); Biome 2.5.14 (biome.json) for TypeScript and Vue `<script>` blocks; ESLint 10 + eslint-plugin-vue (eslint.config.mjs) for Vue `<template>` blocks only. `pnpm lint` runs both.
Strict mode, path conventions, linting, formatting.

### VOS-007 [P0] Add AGENTS.md
**Status:** DONE — AGENTS.md installed at the repository root.
Install repository engineering contract.

---

## EPIC E1 — Local infrastructure

### VOS-010 [P0] Docker Compose
**Status:** DONE — infra/docker-compose.yml — pgvector/pgvector:pg17 + redis:7, healthchecks, role bootstrap.
PostgreSQL + pgvector + Redis.

### VOS-011 [P0] Database package
**Status:** DONE — Prisma models, versioned migrations, generated client, and tenant-scoped database client. SDD-04 is the schema inventory; migration counts are intentionally not completion criteria.
Prisma configuration, migrations, client.

### VOS-012 [P0] Redis/BullMQ package
**Status:** DONE — `@vautrin/queues` owns the ADR-009 queue names, bounded retry defaults, Redis connection, and tenant-bearing event-job contract. The worker consumes the shared package; Redis roundtrip coverage passes. Feature processors belong to VOS-064/VOS-083/VOS-086/VOS-087.
Shared queue configuration.

### VOS-013 [P1] Local email/mock provider
Mailpit or equivalent for development.

---

## EPIC E2 — CI/CD

### VOS-020 [P0] GitHub Actions PR pipeline
**Status:** DONE — `.github/workflows/ci.yml` runs quality, integration, and security checks on PRs and `main`; `.github/workflows/semgrep.yml` scans PRs and all branch pushes.
Lint, typecheck, unit tests, build.

### VOS-021 [P0] Integration-test service containers
**Status:** DONE — ci.yml `integration` job with pgvector/pg17 + redis:7 service containers, role provisioning matching infra/postgres/initdb, migrations, and an assertion that the runtime role cannot bypass RLS.
PostgreSQL + Redis.

### VOS-022 [P1] E2E pipeline
**Status:** TODO — authentication and feature integration tests exist; the product critical path has no E2E pipeline yet.
Run critical web/API tests.

### VOS-023 [P1] Container builds
**Status:** DONE — Dockerfile per deployable (apps/api, apps/worker, apps/web) plus a separate migration-runner image (packages/database) per SDD-12 §7, and a root docker-compose.yml running the full stack.
Build web/api/worker images.

### VOS-024 [P1] Staging deployment
Automated deployment after main.

### VOS-025 [P1] Production deployment gate
Approval + smoke tests + rollback documentation.

### VOS-026 [P0] Secret scanning
**Status:** DONE — CI runs TruffleHog over history, dependency auditing, non-root Dockerfile assertions, and RLS coverage checks. The separate Semgrep Community Edition workflow is the static-analysis gate; CodeQL is not used.
Prevent accidental credential commits.

---

## EPIC E3 — Authentication and tenant foundation

### VOS-030 [P0] User authentication
**Status:** DONE — POST /auth/login, /auth/refresh, /auth/logout, GET /auth/me. Argon2id passwords, JWT access tokens, rotating refresh tokens with reuse detection (ADR-013).
Login/session flow.

### VOS-031 [P0] Tenant entity
**Status:** DONE — TenantService.provision creates a tenant and its first owner in one transaction, without any RLS bypass.
Tenant creation and lifecycle.

### VOS-032 [P0] Tenant membership
**Status:** DONE — TenantService.addMember / revokeMembership over tenant_users, with role assignment.
User ↔ tenant roles.

### VOS-033 [P0] Tenant context
**Status:** DONE — JwtAuthGuard resolves the active tenant from the access token; POST /auth/tenant switches it after re-verifying membership. Client-supplied tenant ids are never trusted (SDD-05 §2).
Resolve active tenant from authenticated request.

### VOS-034 [P0] RBAC
**Status:** DONE — capability model in @vautrin/auth (ADR-011, SDD-09 §3), enforced by a global CapabilityGuard with @RequireCapability. Denials are audited.
Owner/admin/manager/staff/read-only.

### VOS-035 [P0] RLS framework
**Status:** DONE — ENABLE + FORCE RLS on tenant-scoped tables, `app.current_tenant_id()` helper, and migration/CI drift checks for tenant tables without policies.
Enable and test PostgreSQL RLS.

### VOS-036 [P0] Cross-tenant security tests
**Status:** DONE — integration coverage for SELECT/INSERT/UPDATE/DELETE, business configuration, conversations, workflows, vectors, and background jobs runs with the non-privileged runtime role.
Read/write/delete isolation.

---

## EPIC E4 — Business configuration

### VOS-040 [P1] Business profile
**Status:** DONE — tenant-scoped profile read/create/update API for name, contact details, timezone, locale, and currency; manager-only operational settings API for communication preferences, qualification rules, booking rules, and AI configuration; validation and audit.

### VOS-041 [P1] Locations
**Status:** DONE — tenant-scoped CRUD, primary-location serialization, coordinate/timezone validation, cursor pagination, and archive semantics.

### VOS-042 [P1] Services
**Status:** DONE — tenant-scoped service catalog CRUD, key uniqueness, search/filter pagination, and deactivation.

### VOS-043 [P1] Service areas
**Status:** DONE — tenant-scoped service-area CRUD for the ADR-014 types, configuration JSON, filtering/pagination, and deactivation.

### VOS-044 [P1] Business hours
**Status:** DONE — exposed the existing tenant `business_hours` JSON configuration through the business profile API. The SDD specifies weekly availability rules but not their JSON wire shape, so no undocumented schedule format was imposed.

### VOS-045 [P1] Custom field definitions
**Status:** DONE — tenant-scoped, paginated definitions use the existing entity/type enums, options, required/active flags, and display order; definition changes are audited.

### VOS-046 [P1] Custom field values
**Status:** DONE — tenant-scoped values can be listed, set, and removed for contacts, leads, and estimates; writes verify the target entity and definition, validate the stored value against its definition, use the matching entity capability, and are audited.

---

## EPIC E5 — CRM

### VOS-050 [P1] Contacts
**Status:** DONE — tenant-scoped contact CRUD, case-insensitive search, cursor pagination, capability checks, audited mutations, soft archive, and tenant-isolation integration coverage.

### VOS-051 [P1] Leads
**Status:** DONE — tenant-scoped lead CRUD, filtered cursor pagination, active contact/source/service validation, optimistic concurrency, atomic audit, and a `lead.created` outbox event.

### VOS-052 [P1] Lead sources
**Status:** DONE — tenant-owned source catalog CRUD, search/pagination, deactivation, unique keys, and `business.manage` mutation authorization. No hardcoded source catalog is imposed on vertical templates.

### VOS-053 [P1] Lead state transitions
**Status:** DONE — forward progression through SDD-01 statuses, terminal WON/LOST, version checks, audit, and versioned outbox events.

### VOS-054 [P1] Lead assignment
**Status:** DONE — `lead.assign` gated assignment/unassignment to active owner/admin/manager/staff members of the current tenant, with version checks and audit.

### VOS-055 [P1] CRM dashboard
**Status:** DONE — active-tenant total and per-status counts; archived leads are excluded.

---

## EPIC E6 — Conversations

### VOS-060 [P1] Conversation entity
**Status:** PARTIAL — channel-independent tenant Conversation model and authenticated list/read/create/status APIs, with contact/lead validation, audit, cursor pagination, and cross-tenant tests. Provider ingestion, assignment and unified inbox behavior remain.

### VOS-061 [P1] Message entity
**Status:** PARTIAL — tenant Message model and paginated read API, provider event/message and idempotency uniqueness, transactional inbound ingestion, and an idempotent outbound request stored with its audit and outbox event. The worker claims queued messages, checks suppression, and records provider acceptance/status callbacks. Automated coverage for the new outbound lifecycle and stale unknown outcomes remain.

### VOS-062 [P1] Messaging provider interface
**Status:** DONE — `@vautrin/integrations` defines provider-neutral send, inbound webhook, and status callback contracts; domain code does not import the Twilio SDK.

### VOS-063 [P1] First messaging provider adapter
**Status:** PARTIAL — official Twilio Node SDK adapter validates signed inbound/status callbacks and sends through per-tenant credentials. Worker wiring includes known-429 bounded retry and avoids retrying uncertain outcomes; automated coverage and live staging remain.

### VOS-064 [P1] Webhook ingestion
**Status:** PARTIAL — inbound delivery and outbound status callbacks resolve the provisioned integration, validate the exact HTTPS callback URL and Twilio signature, then persist under tenant RLS. Existing integration coverage verifies inbound forgery, replay, and cross-tenant rejection; status-callback coverage, stale-outcome reconciliation, and live provider staging remain.

### VOS-065 [P1] Unified inbox API
**Status:** PARTIAL — tenant-scoped conversation/message list and view APIs plus an idempotent outbound SMS response endpoint are available. A web inbox UI and automated coverage of the response path remain.

---

## EPIC E7 — AI foundation

### VOS-070 [P1] LLMProvider interface
Generation/streaming contract.
**Status:** DONE — provider-neutral generation/streaming, tool-call, usage, cost, and stream-event contracts exist in `@vautrin/integrations`; no provider SDK is included.

### VOS-071 [P1] First LLM adapter
Select provider during implementation.
**Status:** OPEN — intentionally deferred until the product owner selects an LLM provider.

### VOS-072 [P1] Agent entity/configuration
Versioned agent configuration.
**Status:** DONE — tenant-scoped draft/list/read/update/version/lifecycle APIs; activation freezes each version in PostgreSQL. Model config rejects credential values and redacts legacy secret-shaped keys on reads.

### VOS-073 [P1] Tool framework
Typed tool contracts + authorization.
**Status:** PARTIAL — typed allow-listed registry, input/output parsing, permission and approval gates, PostgreSQL idempotency claims, and tenant-scoped tool audit persistence are implemented. Concrete receptionist tools and runtime wiring remain.

### VOS-074 [P1] Business context builder
Structured tenant context.
**Status:** DONE — builds tenant-scoped business/services/service-areas/location and optional lead/contact/conversation context with bounded recent messages and explicit PII exclusions.

### VOS-075 [P1] Knowledge document model
Tenant knowledge.

### VOS-076 [P1] Embedding pipeline
Chunk + embed + persist.

### VOS-077 [P1] pgvector retrieval
Tenant-filtered semantic retrieval.

### VOS-078 [P1] Agent execution telemetry
Agent/tool/provider metadata.
**Status:** PARTIAL — provider/model, agent/prompt versions, token/cached-token counts, estimated cost, latency, structured result, tool count, failure, and handoff persistence are implemented; the runtime must call it once a provider adapter is selected.

---

## EPIC E8 — Workflow engine

### VOS-080 [P0] Event model
**Status:** DONE — versioned `lead.created` and `lead.status_changed` contracts with runtime validation and durable, tenant-scoped outbox rows written with lead state. Outbox dispatch and workflow execution belong to later workflow items.

### VOS-081 [P1] Workflow definition model
Versioned workflows.
**Status:** PARTIAL — tenant-scoped cursor list/read and draft create/edit APIs validate the versioned step envelope; activation/pause/archive, version cloning, and audit are implemented. Type-specific step configuration validation and seeded workflow data remain with their consumers/template.

### VOS-082 [P1] Workflow run model
Persist execution state.
**Status:** PARTIAL — event consumption creates one tenant-scoped pending run per event/workflow version; PostgreSQL-backed step/run transitions cover WAIT, CONDITION, SEND_MESSAGE, END, and explicit unsupported/invalid failures, with persisted bounded retry/failure outcomes. Other step executors remain.

### VOS-083 [P1] Workflow worker
**Status:** PARTIAL — RLS-safe event outbox dispatch and idempotent run creation, plus a tenant-scoped workflow-run reconciler and row-locked WAIT/CONDITION/SEND_MESSAGE/END execution with persisted bounded retry state. Other step executors and the full critical-path E2E remain.

### VOS-084 [P1] Wait step
Delayed jobs.
**Status:** PARTIAL — duration validation, durable PostgreSQL scheduling, delayed BullMQ wake-up and restart reconciliation are implemented; retry jobs share the same recovery path.

### VOS-085 [P1] Condition step
Safe condition evaluation.
**Status:** DONE — bounded structured DSL, typed tenant-scoped runtime context, activation-time structure/operator/field/branch validation, deterministic pure evaluation, false-branch success semantics, and persisted step/audit decisions are implemented. The condition-specific activation/runtime integration cases pass, and the complete worker integration suite is green.

### VOS-086 [P1] Message action
Send through provider abstraction.
**Status:** DONE — literal SMS body config queues a tenant-scoped message and `message.send_requested` outbox event atomically with the step and audit records; existing notification processing routes through the Twilio provider adapter with send-time opt-out checks. Worker integration coverage verifies queue routing, idempotent replay, and opt-out suppression.

### VOS-087 [P1] Agent action
Invoke agent.

### VOS-088 [P1] Idempotency
Prevent duplicate side effects.

### VOS-089 [P1] Retry/failure policy
Bounded retries + escalation.
**Status:** DONE — activation validates bounded attempts, capped exponential delay, retryable/terminal codes, and stop/skip/escalate/human-handoff actions. PostgreSQL persists retry due time/attempts; scheduler recovers retry jobs. Escalation/handoff requests are audited durably; an operator task/assignment surface remains out of scope.

---

## EPIC E9 — Appointments

### VOS-090 [P1] Calendar provider interface
**Status:** DONE — `@vautrin/integrations` defines tenant-aware availability, create, find/reconcile, reschedule, and cancel operations.

### VOS-091 [P1] Calendar adapter
**Status:** PARTIAL — Google Calendar v3 REST adapter queries free/busy, inserts/reconciles, reschedules, and cancels events. A tenant-scoped connection resolver refreshes access tokens from an operator-provisioned secret reference. Booking use cases are wired through the provider boundary. OAuth consent/callback and integration provisioning remain.

### VOS-092 [P1] Appointment domain
**Status:** PARTIAL — tenant-scoped read/list, deterministic V1 availability, create, cancel and reschedule APIs are implemented with validated business hours/booking rules, cross-tenant checks, provider-backed conflict checks, idempotent creation, audit and an outbox event. Provider-mocked API tests pass. OAuth self-service provisioning, agent-facing booking tool and production-like E2E path remain.

### VOS-093 [P1] Booking tool
AI-authorized appointment creation.

### VOS-094 [P1] Booking workflow
Lead → qualification → booking.

---

## EPIC E10 — AI Receptionist

### VOS-100 [P1] Receptionist agent
Business-grounded conversation.

### VOS-101 [P1] Qualification toolset
Service/location/budget/timeline.

### VOS-102 [P1] Human handoff
Explicit escalation.

### VOS-103 [P1] Receptionist evaluation set
Synthetic regression cases.

### VOS-104 [P1] Missed-call workflow
Call missed → AI/SMS → follow-up.

---

## EPIC E11 — Estimates

### VOS-110 [P1] Estimate entity
Create/send/status.

### VOS-111 [P1] Estimate dashboard
Pending/sent/follow-up.

### VOS-112 [P1] Estimate follow-up workflow
Automated reminders.

### VOS-113 [P2] Estimate AI assistant
Draft communication only; no autonomous price approval.

---

## EPIC E12 — Audit and observability

### VOS-120 [P0] Structured logging
Request/job correlation.

### VOS-121 [P0] Audit log
**Status:** PARTIAL — AuditService writes audit_logs for authentication and authorization-denied events. Customer/lead mutations and integration actions are added as those modules land.
Important state changes.

### VOS-122 [P1] Workflow telemetry
Run/step metrics.

### VOS-123 [P1] AI telemetry
Provider/model/token/latency where available.

### VOS-124 [P1] Error tracking
Centralized exception reporting.

### VOS-125 [P1] Operational dashboard
System health and workflow metrics.

---

## EPIC E13 — Remodeling template

### VOS-130 [P1] Remodeling services
Kitchen, bathroom, whole-home, additions, etc.

### VOS-131 [P1] Remodeling custom fields
Project type, property type, budget, timeline, location.

### VOS-132 [P1] Remodeling qualification workflow

### VOS-133 [P1] Remodeling default receptionist configuration

### VOS-134 [P1] Remodeling seed/demo tenant

---

## EPIC E14 — End-to-end vertical slice

### VOS-140 [P0] Critical path E2E
```text
Create tenant
→ configure remodeling
→ inbound lead
→ contact
→ lead
→ conversation
→ AI qualification
→ follow-up
→ appointment
→ estimate
→ estimate follow-up
→ audit
```

### VOS-141 [P0] Tenant isolation E2E

### VOS-142 [P1] Provider failure E2E
Messaging/calendar failure and recovery.

### VOS-143 [P1] Worker retry E2E
Ensure idempotent external action.

---

## Security review log

### 2026-09-21 — authentication CI blockers

- Generate and mask an ephemeral integration-test JWT key; forward it only
  to uncached Turbo integration tasks, without a production/repository secret.
- Keep Semgrep blocking, with documented call-site exceptions for the 11
  reviewed global identity/session and tenant-bootstrap accesses.
- Add configuration and security-rule regressions. At this snapshot, the
  private-repository CodeQL skip remained in place; the 2026-09-22 follow-up
  replaced it with the standalone Semgrep workflow.
- Local validation: lint/typecheck/build, 70 unit tests, and 52 integration
  tests pass. Integration tests also pass from a source snapshot without
  `.env`, using the workflow-generated key. Full Semgrep scan has zero
  findings; both project-rule regression suites pass. GitHub confirmation
  requires committing/pushing these changes.

### 2026-09-22 — v0.2 implementation drift reconciliation

- Align the README, security guide, backlog, and app guides with implemented
  authentication, rate limiting, queue infrastructure, migrations, and API
  coverage.
- Replace the private-repository CodeQL workflow with tokenless Semgrep CI on
  pull requests and all branch pushes.
- Complete the Bruno business-configuration collection for each implemented
  profile, location, service, and service-area operation.

### 2026-09-19 — first security pass (CI introduction)

Findings and disposition:

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Nuxt `/api` proxy allowed path traversal out of the `/api` prefix, reaching arbitrary paths on the internal API host | High | Fixed — path confinement + 12 regression tests |
| 2 | `deepmerge-ts@7.1.5` stack exhaustion (GHSA-ggr8-5vv4-36mx) via `@prisma/client` | High | Fixed — pnpm override to >=8.0.2 |
| 3 | `x-correlation-id` reflected unbounded and unvalidated into responses and future logs | Medium | Fixed — UUID validation, invalid values dropped |
| 4 | No security headers on API or web; `X-Powered-By` disclosed Express and Nuxt | Medium | Fixed — helmet on API, CSP/nosniff/frame-ancestors on web |
| 5 | Requests outside the API global prefix bypass the exception filter and return an Express HTML error page | Low | Accepted — discloses only that Express is in use; revisit with VOS-120 |
| 6 | Compose files default to a well-known local password | Low | Accepted — local dev tooling; production provisioning is VOS-024/VOS-025 |

See SECURITY.md for the standing control list and known gaps.

## Definition of MVP complete

V0.1 is complete only when:
- the critical vertical slice works end-to-end;
- tenant isolation is verified;
- CI/CD deploys repeatably;
- AI tool permissions are enforced;
- workflows are retryable/idempotent;
- a remodeling template provisions a usable tenant;
- the first real customer can operate the revenue workflow without engineering intervention for normal cases.

## Post-MVP backlog

P2/P3 candidates:
- review automation;
- customer re-engagement;
- AI proposal drafting;
- project/task management;
- invoicing;
- payments;
- advanced analytics;
- multi-location support;
- workflow builder UI;
- additional home-service templates;
- additional communication providers;
- enterprise tenant isolation options.

# V0.2 Review Addendum

## Immediate correction tasks

### VOS-027 [P1] Authentication abuse controls
**Status:** DONE — Redis-backed expiring IP/account/token counters with rate-limit observability and no permanent account lockout.

### VOS-028 [P1] Cookie/origin/proxy security contract
**Status:** DONE — same-origin topology documented, exact trusted origins enforced for cookie mutations, and explicit proxy-hop configuration applied before request IP use.

### VOS-037 [P0] Atomic refresh-token rotation
**Status:** DONE — predecessor compare-and-set plus concurrent integration coverage.

### VOS-038 [P0] Preserve active tenant across refresh
**Status:** DONE — refresh sessions persist, inherit, update, and revalidate active tenant selection.

### VOS-039 [P0] Secure membership revocation use case
**Status:** DONE — membership, relevant refresh sessions, and audit record commit atomically with integration coverage.

### VOS-014 [P0] Documentation consistency gate
**Status:** DONE — SDD addenda, ADR-014, and reviewed backlog metadata reconciled.

## Status corrections

- VOS-121 Audit log: **IN_PROGRESS**. Authentication/authorization and contact/business/lead mutations are covered; tool/integration/workflow audit surfaces remain.
- VOS-012 Redis/BullMQ package: the shared package and queue registration are complete; feature processors remain in their respective backlog items.
- VOS-022 E2E pipeline: authentication and feature integration coverage exists, but the product critical-path E2E pipeline remains TODO.

## V0.2 handoff (historical)

At the end of v0.2, review-pack Gates A–D and Gate E prerequisites (VOS-012 and VOS-080) were implemented: security and documentation corrections, Business Configuration, CRM, shared queues, and the versioned event model. Event dispatch, conversations, messaging, scheduling, estimates, agents, and workflow execution were still open. The subsequent v0.3 pack now governs the next milestone below.

The handoff recommended these implementation slices; current status is tracked in the v0.3 plan below:

1. Dispatch persisted events to a tenant-aware queue consumer with bounded retry, failure visibility, and idempotent handling (VOS-083/088/089; ADR-008/009).
2. Add channel-independent conversations and messages, then the messaging provider interface, first adapter, validated/deduplicated webhooks, and inbox API (VOS-060–065).
3. Add the LLM provider abstraction, agent configuration, authorized typed tools, and grounded business context (VOS-070–074); then the remaining knowledge and telemetry work (VOS-075–078).
4. Complete the workflow definition/run/action capabilities (VOS-081–087), then the receptionist and booking/estimate vertical slice (VOS-090–111) with the specified tests and tenant isolation.

## V0.3 implementation plan (2026-09-23 spec pack)

The v0.3 exit gate is the provider-mocked missed-call-to-booking E2E path plus a production-like GCP staging deployment. This is not implied by the v0.2 event/queue foundation.

1. Reconcile ADR-009 and SDD-12, correct the stale infrastructure guide, and keep Pub/Sub/GKE out of V1.
2. Implement bounded, oldest-first outbox dispatch to BullMQ with concurrent claims, at-least-once replay safety, durable consumer identity, recovery polling, and dispatch/consumer telemetry.
3. Build tenant-safe Conversation/Message APIs, a provider-neutral messaging port and one adapter, authenticated/deduplicated webhooks, outbound suppression, and retry-safe sending.
4. Add PostgreSQL-backed workflow definitions/runs and the minimum condition/wait/message/agent/handoff steps; keep delayed intent recoverable from PostgreSQL.
5. Add a provider-neutral LLM port, grounded receptionist runtime and authorized typed tools; then a calendar port and idempotent booking.
6. Seed the remodeling template, implement `missed_call_recovery_v1`, and cover the critical path with deterministic E2E and evaluation cases.
7. Build static Nuxt deployment and the specified GCP/Terraform staging topology; verify backups, restore, rollback, same-origin auth, and operational dashboards before customer onboarding.

Only the first coherent slices should be marked DONE as they pass their own acceptance tests. Provider selection and production GCP credentials are not specified by the pack and must not be guessed or committed.

Current v0.3 progress: workflow retry/failure execution and the provider-neutral AI foundation (agent configuration, context builder, typed tool framework, and telemetry persistence) are implemented in addition to event dispatch and existing condition/wait/message workflow steps. The first LLM adapter and agent-action runtime remain pending provider selection and concrete tools. New API/worker/queue unit suites pass; database-backed integration validation for the added migrations and retry/context/telemetry paths remains. Messaging and calendar provider integrations exist, while OAuth provisioning, booking, receptionist qualification/handoff, remodeling template, deployment infrastructure, and the critical-path E2E release gate remain open.
