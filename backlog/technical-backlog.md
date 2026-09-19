# Vautrin OS — Technical Backlog V0.1

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
**Status:** DONE — packages/database — Prisma schema (26 tables per SDD-04 §3), 4 migrations, tenant-scoped client.
Prisma configuration, migrations, client.

### VOS-012 [P0] Redis/BullMQ package
Shared queue configuration.

### VOS-013 [P1] Local email/mock provider
Mailpit or equivalent for development.

---

## EPIC E2 — CI/CD

### VOS-020 [P0] GitHub Actions PR pipeline
Lint, typecheck, unit tests, build.

### VOS-021 [P0] Integration-test service containers
PostgreSQL + Redis.

### VOS-022 [P1] E2E pipeline
Run critical web/API tests.

### VOS-023 [P1] Container builds
**Status:** DONE — Dockerfile per deployable (apps/api, apps/worker, apps/web) plus a separate migration-runner image (packages/database) per SDD-12 §7, and a root docker-compose.yml running the full stack.
Build web/api/worker images.

### VOS-024 [P1] Staging deployment
Automated deployment after main.

### VOS-025 [P1] Production deployment gate
Approval + smoke tests + rollback documentation.

### VOS-026 [P0] Secret scanning
Prevent accidental credential commits.

---

## EPIC E3 — Authentication and tenant foundation

### VOS-030 [P0] User authentication
Login/session flow.

### VOS-031 [P0] Tenant entity
Tenant creation and lifecycle.

### VOS-032 [P0] Tenant membership
User ↔ tenant roles.

### VOS-033 [P0] Tenant context
Resolve active tenant from authenticated request.

### VOS-034 [P0] RBAC
Owner/admin/manager/staff/read-only.

### VOS-035 [P0] RLS framework
**Status:** DONE — ENABLE + FORCE RLS on all 25 tenant-scoped tables, app.current_tenant_id() helper, drift guard fails the migration if a tenant_id table is left unprotected.
Enable and test PostgreSQL RLS.

### VOS-036 [P0] Cross-tenant security tests
**Status:** DONE — packages/database/test/tenant-isolation.integration.test.ts — SELECT/INSERT/UPDATE/DELETE, conversation, workflow, vector, and background-job isolation, run as the non-privileged runtime role.
Read/write/delete isolation.

---

## EPIC E4 — Business configuration

### VOS-040 [P1] Business profile
Name, contact details, timezone, locale.

### VOS-041 [P1] Locations
Service/physical locations.

### VOS-042 [P1] Services
Service catalog.

### VOS-043 [P1] Service areas
Cities/ZIP/service regions.

### VOS-044 [P1] Business hours
Weekly availability rules.

### VOS-045 [P1] Custom field definitions
Generic vertical-specific fields.

### VOS-046 [P1] Custom field values
Lead/contact/estimate values.

---

## EPIC E5 — CRM

### VOS-050 [P1] Contacts
CRUD + search + pagination.

### VOS-051 [P1] Leads
CRUD + pipeline.

### VOS-052 [P1] Lead sources
Google, website, phone, referral, ads, etc.

### VOS-053 [P1] Lead state transitions
Validate lifecycle transitions.

### VOS-054 [P1] Lead assignment
Owner/staff assignment.

### VOS-055 [P1] CRM dashboard
Lead counts and pipeline.

---

## EPIC E6 — Conversations

### VOS-060 [P1] Conversation entity
Channel-independent thread.

### VOS-061 [P1] Message entity
Inbound/outbound state.

### VOS-062 [P1] Messaging provider interface
No provider-specific domain dependency.

### VOS-063 [P1] First messaging provider adapter
Select provider during implementation.

### VOS-064 [P1] Webhook ingestion
Signature validation + deduplication.

### VOS-065 [P1] Unified inbox API
List/view/respond.

---

## EPIC E7 — AI foundation

### VOS-070 [P1] LLMProvider interface
Generation/streaming contract.

### VOS-071 [P1] First LLM adapter
Select provider during implementation.

### VOS-072 [P1] Agent entity/configuration
Versioned agent configuration.

### VOS-073 [P1] Tool framework
Typed tool contracts + authorization.

### VOS-074 [P1] Business context builder
Structured tenant context.

### VOS-075 [P1] Knowledge document model
Tenant knowledge.

### VOS-076 [P1] Embedding pipeline
Chunk + embed + persist.

### VOS-077 [P1] pgvector retrieval
Tenant-filtered semantic retrieval.

### VOS-078 [P1] Agent execution telemetry
Agent/tool/provider metadata.

---

## EPIC E8 — Workflow engine

### VOS-080 [P0] Event model
Versioned internal event schema.

### VOS-081 [P1] Workflow definition model
Versioned workflows.

### VOS-082 [P1] Workflow run model
Persist execution state.

### VOS-083 [P1] Workflow worker
BullMQ execution.

### VOS-084 [P1] Wait step
Delayed jobs.

### VOS-085 [P1] Condition step
Safe condition evaluation.

### VOS-086 [P1] Message action
Send through provider abstraction.

### VOS-087 [P1] Agent action
Invoke agent.

### VOS-088 [P1] Idempotency
Prevent duplicate side effects.

### VOS-089 [P1] Retry/failure policy
Bounded retries + escalation.

---

## EPIC E9 — Appointments

### VOS-090 [P1] Calendar provider interface
Availability/create/cancel.

### VOS-091 [P1] Calendar adapter
First provider.

### VOS-092 [P1] Appointment domain
State and validation.

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
