# SDD-12 — GCP Deployment and CI/CD v0.3

## 1. Deployment objective

V0.3 optimizes for safely operating the first 10 paying customers, not for a hypothetical 10,000-tenant topology.

Production baseline:

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

```text
local
staging
production
```

Staging and production SHALL be isolated at least by GCP project or by an equivalently strong IAM/network/resource boundary. Production secrets and databases must never be shared with staging.

## 3. GCP service mapping

| Concern | V0.3 service |
|---|---|
| Static frontend | GCS backend bucket |
| Frontend caching | Cloud CDN |
| Public HTTPS/routing | External Application Load Balancer |
| API compute | Compute Engine; move to MIG as redundancy/autoscaling is required |
| Worker compute | Compute Engine; independently scalable from API |
| Container images | Artifact Registry |
| Relational/vector DB | Cloud SQL for PostgreSQL + pgvector |
| Async jobs | Redis + BullMQ |
| Production Redis | Managed private Redis on GCP when first-customer production reliability requires it |
| Object/document storage | GCS |
| Secrets | Secret Manager |
| Logs/metrics | Cloud Logging + Cloud Monitoring; OpenTelemetry-compatible application instrumentation |
| Infrastructure as code | Terraform |
| CI/CD | GitHub Actions |

Pub/Sub is not part of the V1 critical path (ADR-009).

## 4. Frontend deployment

`apps/web` SHALL support a static production build suitable for GCS hosting.

The production application SHOULD preserve a same-origin browser contract by routing `/api/*` through the same external HTTPS load balancer to the API backend while routing static paths to the GCS backend bucket. This preserves the security assumptions behind HttpOnly refresh cookies and avoids unnecessary cross-origin complexity.

Any current Nuxt/Nitro server-only proxy behavior used in local/container development must not be required by the production static build. API access must be expressed through a browser-safe `/api` base path.

SPA/static-route fallback behavior SHALL be configured and tested for direct navigation to authenticated application routes.

Deploy sequence:

1. build/generate static Nuxt assets;
2. upload immutable/versioned assets to GCS;
3. set appropriate cache metadata;
4. update/invalidate only mutable shell assets when necessary;
5. run frontend smoke tests through the production/staging load-balancer URL.

## 5. API deployment

`apps/api` remains a stateless NestJS container.

For the first customers a single production Compute Engine instance is acceptable if backups, monitoring and recovery are explicit. Before uptime requirements justify it, the preferred evolution is a regional/multi-zone Managed Instance Group behind the load balancer with health-based autohealing.

API instances SHALL:

- run containers as non-root;
- use a dedicated GCP service account;
- receive secrets through Secret Manager or deployment-time secret injection;
- access Cloud SQL and Redis over private networking where practical;
- expose liveness/readiness endpoints;
- terminate gracefully on deployment/shutdown;
- remain free of durable local application state.

## 6. Worker deployment

`apps/worker` is deployed independently from the API and exposes no public application port.

The worker SHALL:

- consume the four ADR-009 BullMQ queues;
- establish tenant context from validated job payloads;
- shut down gracefully so BullMQ can release/recover work correctly;
- emit heartbeat/processing telemetry once feature processors are active;
- scale independently from API compute;
- never use local disk as authoritative job or workflow state.

## 7. Cloud SQL

Cloud SQL PostgreSQL SHALL host the existing Prisma schema, RLS policies and pgvector data.

Initial production may use a cost-conscious single-zone instance while the customer base is very small, provided automated backups and point-in-time recovery are enabled and restore is tested.

Move to HA before an outage of a single zone/instance would create unacceptable customer impact.

Requirements:

- private connectivity where practical;
- automated backups;
- point-in-time recovery;
- separate migration credentials from runtime credentials;
- runtime role remains `NOBYPASSRLS` and least privileged;
- connection limits/pooling monitored before scaling API/worker replicas;
- database alerts for storage, CPU, memory/connection pressure and failed backups.

## 8. Redis/BullMQ

Local development uses Redis from Docker Compose.

Production Redis SHALL be private and authenticated/encrypted according to the selected GCP managed Redis configuration. It exists primarily for BullMQ.

Redis persistence alone SHALL NOT be treated as the durable record of workflow intent. PostgreSQL workflow/event state must permit reconciliation of work that should exist.

Operational alerts should include Redis availability, memory pressure, queue depth, oldest waiting job, failed-job count and stalled jobs.

## 9. Local development

Docker Compose continues to provide:

- PostgreSQL + pgvector;
- Redis;
- optional Mailpit;
- optional provider mocks.

The local stack does not need to emulate GCS, Cloud SQL, Compute Engine or the GCP load balancer exactly. Application ports/adapters and integration tests are the portability boundary.

## 10. CI pipeline

```text
Pull Request
  -> install pinned dependencies
  -> lint
  -> typecheck
  -> unit tests
  -> integration tests (PostgreSQL + Redis)
  -> tenant/RLS security tests
  -> build affected applications/packages
  -> container build validation
  -> security/secret/dependency checks
```

The product critical-path E2E test remains required before MVP completion.

## 11. Main/staging deployment

On merge to `main`:

1. build immutable API/worker/migration images;
2. push images to Artifact Registry using commit SHA tags;
3. build/generate Nuxt static output;
4. run database migration job with migration credentials;
5. deploy API and worker to staging;
6. deploy frontend assets to staging GCS;
7. run health and smoke tests;
8. fail the release if migration, readiness, queue connectivity or smoke tests fail.

## 12. Production deployment

Production requires:

- successful staging deployment;
- migration safety check;
- explicit release approval while the product is early-stage;
- immutable artifact promotion/rebuild policy documented;
- migration execution before incompatible application rollout;
- API/worker deployment;
- frontend deployment;
- health/smoke verification;
- rollback procedure.

## 13. Database migration policy

`prisma migrate deploy` SHALL run as a separate deployment step/container using the migration role.

Application startup SHALL NOT execute schema migrations.

Destructive changes use expand/contract migrations. Application rollback should remain possible independently from database rollback whenever feasible.

## 14. Terraform

GCP production infrastructure SHALL be reproducible with Terraform. Initial modules should cover:

- project/service enablement where appropriate;
- VPC/network/firewall;
- GCS frontend bucket;
- external HTTPS load balancer/backend bucket/CDN;
- API compute and service account;
- worker compute and service account;
- Cloud SQL;
- Redis;
- Artifact Registry;
- Secret Manager/IAM;
- logging/monitoring alerts.

Do not create Kubernetes/GKE infrastructure for V1.

## 15. Secrets and IAM

No long-lived GCP service-account key SHALL be committed or baked into images.

Use workload identity federation from GitHub Actions where supported. Runtime compute uses attached least-privileged service accounts.

Provider credentials (LLM, messaging, calendar, etc.) belong in Secret Manager or an approved encrypted credential mechanism, never source control or logs.

## 16. Observability

At minimum production telemetry SHALL support:

- request/correlation ID;
- tenant ID where safe;
- API latency/error rate;
- worker job latency/failure/retry;
- queue depth/stalled jobs;
- Cloud SQL health/connections;
- Redis health/memory;
- provider latency/errors;
- AI model/provider/token/cost telemetry when AI work lands.

PII, access tokens, refresh tokens and provider secrets must not be logged.

## 17. Backups and disaster recovery

Before customer #1:

- Cloud SQL automated backup enabled;
- PITR configured;
- restore drill performed and documented;
- critical GCS data versioning/retention policy decided;
- Redis loss scenario tested against workflow/event reconciliation assumptions;
- infrastructure recreation from Terraform tested at least in staging.

## 18. Scaling policy for first 10 customers

Prefer vertical simplicity before horizontal complexity.

Scale API/worker resources only from observed CPU, memory, latency, queue-depth and DB-connection pressure. Do not introduce Pub/Sub, GKE, microservices, multi-region databases, or additional caches solely for hypothetical scale.

The first scaling boundary should normally be:

1. independently resize API and worker compute;
2. tune Cloud SQL and connection usage;
3. increase Redis capacity if queue metrics require it;
4. add API/worker replicas/MIGs;
5. only then evaluate architectural distribution.

## 19. Production readiness for first paying customer

Required:

- GCP infrastructure reproducible;
- TLS/domain routing works through load balancer;
- static Nuxt deep-link and `/api/*` routing verified;
- Cloud SQL backups + restore drill verified;
- Redis/BullMQ connectivity and retry behavior verified;
- tenant isolation tests green;
- auth/cookie/origin behavior tested against real production topology;
- secrets/IAM configured;
- audit/logging verified;
- monitoring/alerts configured;
- provider failure paths tested;
- migration and rollback procedure documented;
- critical revenue workflow has E2E coverage before onboarding customers onto that workflow.
