# AGENTS.md — Vautrin OS Engineering Contract

This file is the default instruction set for AI coding agents working in the Vautrin OS repository.

## 1. Mission

Build Vautrin OS as a secure, multi-tenant, modular SaaS platform for local businesses.

The first vertical is remodeling/home services.

Do not optimize for feature volume. Optimize for:
- correctness;
- tenant isolation;
- maintainability;
- testability;
- observable behavior;
- small, reviewable changes.

## 2. Architecture rules

1. The repository is a pnpm workspace managed by Turborepo.
2. The frontend is Nuxt 4 + Vue 3 + TypeScript.
3. The backend is NestJS + TypeScript.
4. The backend is a modular monolith.
5. `apps/api` is the HTTP/API application.
6. `apps/worker` handles asynchronous jobs and workflow execution.
7. PostgreSQL is the source of truth.
8. Redis/BullMQ is for asynchronous work, not durable business state.
9. pgvector is used for semantic knowledge retrieval.
10. Integrations must be accessed through provider interfaces.
11. LLM providers must be hidden behind an internal provider abstraction.
12. Domain logic must not depend directly on HTTP controllers.
13. Domain logic must not depend directly on an LLM vendor.
14. AI agents may act only through explicitly authorized tools.
15. Tenant-scoped data must always carry tenant context.
16. Do not introduce microservices unless an ADR justifies extraction.

## 3. Multi-tenancy rules

- Every tenant-scoped table has `tenant_id`.
- Every repository query must be tenant-aware.
- PostgreSQL RLS is required for tenant-scoped data.
- Never accept a tenant ID from a client as an authorization decision.
- Derive the active tenant from authenticated membership/context.
- Cross-tenant access must have automated tests.
- Background jobs must carry tenant context explicitly.
- Logs must contain tenant context where applicable.

## 4. Database rules

- Use migrations; never use `db push` in production.
- Do not mutate production schema manually.
- Add indexes based on actual access patterns.
- Use UUID/UUIDv7-style identifiers rather than sequential public IDs.
- Keep structured business data relational.
- Use JSONB only for genuinely flexible configuration.
- Use pgvector for unstructured semantic retrieval, not as a replacement for relational queries.
- Every migration must be reviewable and reversible where practical.

## 5. NestJS rules

- Use modules to encapsulate business capabilities.
- Controllers are thin.
- Application services orchestrate use cases.
- Domain logic belongs outside controllers.
- Infrastructure adapters implement interfaces.
- Avoid circular dependencies.
- Prefer explicit dependency injection.

## 6. AI rules

- Never give an LLM direct database access.
- Never allow arbitrary tool execution.
- Every tool has a typed input/output contract.
- Every sensitive tool has authorization and validation.
- High-impact actions may require human approval.
- Prompts are versioned artifacts.
- Model/provider configuration is tenant-aware.
- Store AI execution metadata required for debugging and cost analysis.
- Never fabricate business facts when the source of truth is unavailable.
- When uncertain, the agent should ask, escalate, or decline rather than invent.

## 7. Workflow rules

- Workflows are event-driven.
- Workflow definitions must be data/configuration, not scattered business conditionals.
- Workflow execution must be idempotent.
- Retries must be bounded and observable.
- Long-running work belongs in BullMQ workers.
- A workflow must define failure behavior.
- Actions that send external messages should have idempotency protection.

## 8. API rules

- Validate external input at the boundary.
- Return stable DTOs/contracts.
- Use consistent error responses.
- Do not leak internal exceptions.
- Document public API behavior with OpenAPI.
- Pagination is mandatory for list endpoints expected to grow.

## 9. Testing rules

Every feature should include the smallest meaningful test set:
- unit tests for domain/application behavior;
- integration tests for persistence/infrastructure;
- tenant-isolation tests where data access is involved;
- E2E tests for critical user workflows.

AI features additionally require:
- deterministic mocked tool tests;
- prompt/behavior evaluation cases;
- hallucination/grounding checks;
- failure and escalation tests.

## 10. Security rules

- Secrets never enter source control.
- Use environment/secret-manager configuration.
- Do not log tokens, passwords, raw credentials, or sensitive customer data unnecessarily.
- Audit important state-changing actions.
- Principle of least privilege applies to users, agents, integrations, and infrastructure.

## 11. Code quality

- TypeScript strict mode.
- Avoid `any`; justify exceptions.
- Prefer explicit types at system boundaries.
- Avoid premature abstractions.
- Prefer small cohesive modules.
- Do not duplicate domain rules between frontend and backend.
- Use shared contracts for API boundaries where appropriate.

## 12. Change protocol for AI agents

Before changing architecture:
1. Read the relevant SDD.
2. Read relevant ADRs.
3. Identify impacted modules.
4. Update the implementation plan.
5. Implement the smallest coherent change.
6. Add tests.
7. Run affected checks.
8. Update documentation when behavior/architecture changes.

If a task contradicts an ADR, do not silently override it. Propose an ADR change.

## 13. Definition of Done

A task is not complete when the code merely runs.

It is complete when:
- acceptance criteria are met;
- tests pass;
- tenant isolation is verified where relevant;
- migrations are included;
- observability is present for operational behavior;
- API contracts are updated;
- documentation is updated when necessary;
- CI passes.

## 14. What not to build in V0.1

Do not introduce:
- microservice infrastructure;
- Kubernetes;
- custom LLM training;
- fine-tuning pipelines;
- a complete accounting platform;
- a complete project-management replacement;
- a native mobile app;
- a marketplace;
- autonomous financial decisions.

Build the revenue-engine vertical slice first.
