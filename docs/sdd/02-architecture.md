# SDD-02 — Architecture

## 1. Architecture style

Vautrin OS uses a **modular monolith** for the MVP.

This gives us:
- one deployable API;
- strong module boundaries;
- low operational overhead;
- fast development;
- a clear extraction path for future services.

The asynchronous worker is a separate deployable application from the beginning.

## 2. Repository architecture

```text
vautrin-os/
├── apps/
│   ├── web/
│   ├── api/
│   └── worker/
├── packages/
│   ├── config/
│   ├── database/
│   ├── domain/
│   ├── contracts/
│   ├── auth/
│   ├── ai/
│   ├── workflows/
│   ├── integrations/
│   ├── observability/
│   └── testing/
├── templates/
│   ├── remodeling/
│   ├── hvac/
│   ├── roofing/
│   └── generic-local-business/
├── docs/
├── infra/
└── .github/
```

## 3. Applications

### Web
Nuxt 4 + Vue 3.

### API
NestJS HTTP application.

### Worker
NestJS process responsible for asynchronous processing.

## 4. Backend module map

```text
AuthModule
TenantModule
BusinessModule
ContactModule
LeadModule
ConversationModule
AppointmentModule
EstimateModule
WorkflowModule
AgentModule
KnowledgeModule
IntegrationModule
AnalyticsModule
AuditModule
```

## 5. Dependency direction

```text
Presentation
    ↓
Application
    ↓
Domain
    ↑
Infrastructure
```

Infrastructure implements interfaces defined by the application/domain boundary.

Domain must not import Prisma, Redis, HTTP clients, or LLM SDKs directly.

## 6. API boundary

The API exposes DTOs/contracts.

Frontend must not depend on backend internal domain entities.

Shared contracts are allowed for:
- request schemas;
- response DTOs;
- event schemas;
- public enums.

## 7. Worker boundary

The API publishes jobs/events.

The worker consumes them.

Example:

```text
POST /leads
  -> database transaction
  -> publish lead.created
  -> enqueue follow-up/AI work if required
  -> HTTP response
```

## 8. Scalability path

MVP:

```text
Nuxt
Nest API
Nest Worker
Postgres
Redis
```

Future extraction candidates:

```text
Voice Service
AI Execution Service
Workflow Worker Pool
Analytics Pipeline
Integration Gateway
```

Extraction requires an ADR and measurable justification.

## 9. Deployment topology

```text
Internet
  |
Load Balancer / Edge
  |
Nuxt Web
  |
Nest API
  |
  +---- PostgreSQL
  +---- Redis
  |
Worker
  |
External Providers
```

## 10. Technology principles

- Prefer boring infrastructure.
- Keep business state in PostgreSQL.
- Keep queues disposable/replayable.
- Keep external providers behind adapters.
- Keep AI behind interfaces.
- Keep tenant isolation explicit at every layer.
