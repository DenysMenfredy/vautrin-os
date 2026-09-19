# SDD-12 — Deployment and CI/CD

## 1. Environments

```text
local
staging
production
```

## 2. Local development

Docker Compose should provide:
- PostgreSQL + pgvector;
- Redis;
- optional Mailpit;
- optional local provider mocks.

## 3. CI pipeline

```text
Pull Request
  ↓
Checkout
  ↓
Install pnpm dependencies
  ↓
Turborepo affected lint/typecheck/test
  ↓
Build affected applications
  ↓
Integration tests
  ↓
E2E tests
  ↓
Security checks
```

## 4. Merge

`main` must remain deployable.

## 5. Staging deployment

On successful merge:
- build container images;
- publish immutable image tags;
- deploy API;
- deploy worker;
- deploy web;
- run database migrations;
- run smoke tests.

## 6. Production deployment

Production should require:
- successful staging;
- migration safety check;
- explicit approval if the environment requires it;
- deployment;
- health checks;
- smoke tests;
- rollback path.

## 7. Database migration policy

Migrations are deployed separately from application startup where practical.

Application startup must not race multiple instances attempting arbitrary schema changes.

## 8. Container strategy

Use one Dockerfile per deployable application where practical:
- web;
- api;
- worker.

Shared packages are compiled into the relevant application image.

## 9. Image tagging

Use immutable tags based on commit SHA.

Human-readable release tags may be added, but deployments must be reproducible.

## 10. Rollback

Application rollback must be possible independently from database rollback where feasible.

Destructive database migrations require expand/contract planning.

## 11. Monorepo optimization

Turborepo should determine affected tasks using the repository dependency graph.

Do not run expensive E2E/build steps for unrelated changes unless the task graph
or safety policy requires them.

## 12. Production readiness

Before the first real customer:
- backups verified;
- restore procedure tested;
- secrets configured;
- tenant isolation tests green;
- audit/logging verified;
- monitoring configured;
- provider failure paths tested.
