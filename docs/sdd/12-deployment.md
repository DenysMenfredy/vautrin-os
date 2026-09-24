# SDD-12 — GCP Deployment and CI/CD v0.3

## 1. Deployment objective

V0.3 optimizes for safely operating the first 10 paying customers, not for a hypothetical 10,000-tenant topology.

```text
Browser
  |
  v
External HTTPS Load Balancer
  |-- /* ------> GCS backend bucket + Cloud CDN --> Nuxt static application
  |-- /api/* --> Compute Engine API instance/MIG --> NestJS API
                                      |-- Cloud SQL PostgreSQL + pgvector
                                      |-- Redis/BullMQ
                                               |
                                               v
                                      Compute Engine worker
                                      NestJS standalone worker
```

PostgreSQL is the source of truth. Redis/BullMQ is asynchronous execution infrastructure.

## 2. Environments

`local`, `staging`, and `production`. Staging and production SHALL be isolated at least by GCP project or by an equivalently strong IAM/network/resource boundary. Production secrets and databases must never be shared with staging.

## 3. GCP service mapping

| Concern | V0.3 service |
|---|---|
| Static frontend | GCS backend bucket |
| Frontend caching | Cloud CDN |
| Public HTTPS/routing | External Application Load Balancer |
| API compute | Compute Engine; MIG when redundancy/autoscaling is required |
| Worker compute | Compute Engine; independently scalable from API |
| Container images | Artifact Registry |
| Relational/vector DB | Cloud SQL for PostgreSQL + pgvector |
| Async jobs | Redis + BullMQ |
| Production Redis | Private managed Redis on GCP when reliability requires it |
| Object/document storage | GCS |
| Secrets | Secret Manager |
| Logs/metrics | Cloud Logging + Cloud Monitoring; OpenTelemetry-compatible instrumentation |
| Infrastructure as code | Terraform |
| CI/CD | GitHub Actions |

Pub/Sub is not part of the V1 critical path (ADR-009).

## 4. Frontend deployment

`apps/web` SHALL support a static production build suitable for GCS. Route `/api/*` through the same external HTTPS load balancer to the API backend, and static paths to the GCS backend bucket. This preserves same-origin HttpOnly refresh-cookie behavior. A local/container Nitro proxy must not be required by the static build; browser API calls use `/api`.

Configure and test SPA/static-route fallback for direct navigation to authenticated routes. Generate static assets, upload immutable/versioned assets to GCS with appropriate cache metadata, invalidate only mutable shell assets as needed, and smoke-test through the staging/production load-balancer URL.

## 5. API deployment

`apps/api` remains a stateless NestJS container. A single production Compute Engine instance is acceptable initially only with explicit backup, monitoring, and recovery. Evolve to a regional/multi-zone MIG with autohealing when uptime needs justify it. Instances run non-root, use dedicated service accounts, receive secrets from Secret Manager or deployment-time injection, access Cloud SQL/Redis privately where practical, expose liveness/readiness, shut down gracefully, and hold no durable local business state. Public ingress is only through the intended load balancer.

## 6. Worker deployment

`apps/worker` deploys independently and exposes no public application port. It SHALL consume the four ADR-009 queues, validate tenant-bearing jobs before RLS access, shut down gracefully, emit processor heartbeat/telemetry when active, and keep durable workflow state in PostgreSQL rather than local disk.

## 7. Cloud SQL

Cloud SQL hosts the existing Prisma schema, RLS policies, and pgvector data. A cost-conscious single-zone instance is acceptable initially only with automated backups, PITR, and a tested restore; move to HA before a zone/instance outage becomes unacceptable. Use private connectivity where practical, separate migration credentials, a NOBYPASSRLS least-privilege runtime role, and monitor connections/pooling, storage, CPU, memory, and backup failures.

## 8. Redis/BullMQ

Local development uses Compose Redis. Production Redis SHALL be private and authenticated/encrypted according to the selected GCP service. Redis is execution infrastructure, never the only durable record of workflow intent. Reconciliation from PostgreSQL must recover missing work. Alert on availability, memory pressure, queue depth, oldest waiting job, failures, and stalls.

## 9. Local development

Compose provides PostgreSQL + pgvector, Redis, optional Mailpit and provider mocks. Local need not emulate every GCP service; application ports/adapters and integration tests form the portability boundary.

## 10. CI pipeline

PRs install pinned dependencies, lint, typecheck, run unit/integration and tenant/RLS security tests, build affected apps/packages and containers, and run security/secret/dependency checks. Product critical-path E2E remains required before MVP completion. `main` must remain deployable.

## 11. Main/staging deployment

On merge: build immutable API/worker/migration images and push SHA tags to Artifact Registry; generate static Nuxt output; run the migration job with migration credentials; deploy API/worker to staging; deploy static assets to staging GCS; verify readiness, queue connectivity, and smoke tests. Fail the release when migration, readiness, queue, or smoke validation fails.

## 12. Production deployment

Require successful staging, migration safety review, explicit early-stage release approval, documented artifact promotion/rebuild policy, migration before incompatible rollout, API/worker and frontend deployment, health/smoke verification, and rollback.

## 13. Database migration policy

Run `prisma migrate deploy` as a separate step/container with the migration role. Application startup SHALL NOT migrate. Destructive changes use expand/contract migrations; application rollback should remain possible independently of schema rollback where feasible.

## 14. Terraform

Initial modules cover project/service enablement where appropriate, VPC/firewall, GCS frontend bucket, external HTTPS load balancer/backend bucket/CDN, API/worker compute and service accounts, Cloud SQL, Redis, Artifact Registry, Secret Manager/IAM, and logging/monitoring alerts. Do not create Kubernetes/GKE infrastructure for V1.

## 15. Secrets and IAM

Never commit or bake long-lived GCP service-account keys into images. Use GitHub Actions workload identity federation where supported and attached least-privilege service accounts for compute. Provider credentials belong in Secret Manager or approved encrypted storage, never source or logs.

## 16. Observability

Production telemetry covers correlation/request ID, tenant ID where safe, API latency/error rate, worker job latency/failure/retry, queue depth/stalls, Cloud SQL and Redis health, provider latency/errors, and AI provider/model/token/cost metadata when AI lands. Never log PII, tokens, or provider secrets.

## 17. Backups and disaster recovery

Before customer #1: enable automated Cloud SQL backup and PITR, perform and document a restore drill, decide GCS versioning/retention for critical data, test Redis loss against workflow/event reconciliation, and recreate infrastructure from Terraform at least in staging.

## 18. Scaling policy for first 10 customers

Scale from observed CPU, memory, latency, queue depth, and DB connection pressure. Resize API and worker independently, tune Cloud SQL connections, increase Redis capacity if needed, then add replicas/MIGs. Only then evaluate distribution. Do not add Pub/Sub, GKE, microservices, or multi-region DB for hypothetical scale.

## 19. Production readiness

Before the first paying customer, verify reproducible GCP infrastructure, TLS and same-origin routing, static deep links, backups/PITR/restore, Redis/BullMQ retries, tenant isolation, auth cookies/origin through the real topology, secrets/IAM, audit/logs/alerts, provider failure paths, migration/rollback, and critical-path E2E coverage.
