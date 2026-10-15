# Vautrin OS — Architecture and Implementation Baseline

Vautrin OS is a multi-tenant SaaS platform for local businesses, initially
verticalized for remodeling and home-service businesses in the United States.

This documentation package is the architectural baseline for MVP development.
It is intentionally written in English so it can be consumed directly by
human developers and AI coding agents.

## Current implementation

The repository has the monorepo, database, tenant-isolation, authentication,
and CI foundations in place. Registration is operator-controlled: after
building `@vautrin/api`, run
`pnpm --filter @vautrin/api onboard:tenant --slug my-business --name "My Business" --owner-email owner@example.com`.
The command returns a one-time token for the owner to submit to
`POST /api/auth/invitations/accept` with a new password. Deliver the token
privately. Active owners/admins can issue further invitations through
`POST /api/tenant/invitations`; there is no public tenant signup.
If the first owner's token expires, the operator can run
`pnpm --filter @vautrin/api onboard:tenant --reissue-owner --tenant-id UUID --owner-email owner@example.com`.

Business Configuration includes the profile
(including business-hours configuration), locations, services, service areas,
custom field definitions, and custom field values. CRM now includes contacts,
leads, tenant-owned lead sources, lifecycle transitions, assignment, and a
minimal pipeline dashboard. The shared queue package and versioned lead
outbox events establish the v0.2 events-and-queues gate. See
[`backlog/technical-backlog.md`](backlog/technical-backlog.md) for task status
and acceptance criteria.

V0.3 includes RLS-safe outbox dispatch, tenant-scoped conversation/message
APIs, durable workflow execution, booking rules and availability, and Twilio
and Google Calendar provider integrations. The OpenAI receptionist, typed grounded
qualification/booking tools, human handoff, remodeling installer, missed-call
recovery and operations frontend are implemented and covered by deterministic
release tests. See [local v0.3 setup](docs/v0.3-local-setup.md) and the
[completion evidence](docs/v0.3-completion-plan.md). GCP Terraform and deployment
artifacts are prepared; live provider smoke, staging/restore/rollback drills and
unpatched dependency advisories remain release gates.

## Source-review archives

Do not ZIP the working directory: local `.env` files and credentials can be
included even though Git ignores them. For a source-only review package,
commit the intended changes first, then run
`git archive --format=zip --output=/tmp/vautrin-os-review.zip HEAD` and inspect
the archive's file list before sharing it. The tracked `.env.example` contains
placeholders; `.env` must never be included. If an archive containing a real
`.env` has been shared, rotate the exposed credentials.

## Product principle

Sell operational outcomes, not AI technology.

The MVP focuses on:

> Lead capture → AI reception → qualification → follow-up → appointment → estimate → estimate follow-up.

The architecture is vertical-agnostic even though the first production template is `remodeling`.

## Architecture baseline

- Monorepo: pnpm workspaces + Turborepo
- Frontend: Nuxt 4 + Vue 3 + TypeScript
- Backend: NestJS + TypeScript
- Architecture: Modular monolith
- Database: PostgreSQL
- Vector search: pgvector
- Async processing: Redis + BullMQ
- AI: provider-agnostic LLM abstraction
- Linting/formatting: Biome (+ ESLint with eslint-plugin-vue for Vue templates)
- Testing: Vitest
- CI/CD: GitHub Actions
- Deployment: containerized
- Multi-tenancy: pooled model with application isolation + PostgreSQL RLS
- Observability: structured logs + tracing/metrics-ready interfaces
- Testing: unit + integration + E2E + tenant-isolation + AI evaluation

## Documentation map

### SDD
- `docs/sdd/00-overview.md`
- `docs/sdd/01-requirements.md`
- `docs/sdd/02-architecture.md`
- `docs/sdd/03-domain-model.md`
- `docs/sdd/04-database.md`
- `docs/sdd/05-multitenancy.md`
- `docs/sdd/06-ai-system.md`
- `docs/sdd/07-workflow-engine.md`
- `docs/sdd/08-integrations.md`
- `docs/sdd/09-security.md`
- `docs/sdd/10-observability.md`
- `docs/sdd/11-testing.md`
- `docs/sdd/12-deployment.md`

### ADR
- `docs/adr/001-monorepo-strategy.md`
- `docs/adr/002-modular-monolith.md`
- `docs/adr/003-multi-tenancy.md`
- `docs/adr/004-postgresql-pgvector.md`
- `docs/adr/005-tenant-isolation-rls.md`
- `docs/adr/006-ai-provider-abstraction.md`
- `docs/adr/007-workflow-engine.md`
- `docs/adr/008-event-driven-processing.md`
- `docs/adr/009-queue-strategy.md`
- `docs/adr/010-integration-abstraction.md`
- `docs/adr/011-authentication-rbac.md`
- `docs/adr/012-observability.md`
- `docs/adr/013-session-and-token-strategy.md`
- `docs/adr/014-service-and-service-area-modeling.md`
- `docs/adr/015-operator-controlled-onboarding.md`

### Engineering agent guidance
- `AGENTS.md`

### Delivery
- `backlog/technical-backlog.md`

## Source of truth

When implementation conflicts with these documents, do not silently improvise.
Create or update an ADR, then update the affected SDD and backlog.

## Current scope boundary

The current MVP scope excludes:
- full accounting;
- payments processing;
- full project management;
- mobile applications;
- social media management;
- custom/fine-tuned LLMs;
- autonomous high-risk financial actions;
- a replacement for every contractor-specific system.

## Official technology references

- Nuxt: https://nuxt.com/
- NestJS modules: https://docs.nestjs.com/modules
- NestJS queues / BullMQ: https://docs.nestjs.com/techniques/queues
- PostgreSQL RLS: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- PostgreSQL policies: https://www.postgresql.org/docs/current/sql-createpolicy.html
- Turborepo: https://turborepo.com/
- Prisma: https://www.prisma.io/
