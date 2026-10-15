# GCP v0.3 infrastructure

This root Terraform module prepares an isolated staging/production project with
private PostgreSQL 17, pgvector prerequisites, authenticated TLS Redis/BullMQ,
API/worker VMs without public addresses, NAT, Artifact Registry, per-process
service accounts, Secret Manager, a static GCS/CDN frontend, HTTPS/API routing,
monitoring and optional GitHub workload identity federation. It creates no secret
versions. It does not deploy cloud resources during local tests.

## Required inputs and bootstrap

1. Supply the project, region, zone and application hostname in a private
   `environment.tfvars`, using `environment.tfvars.example` as a shape. Staging
   and production use separate projects/state buckets. Protect and version the
   state bucket: Redis credentials are sensitive computed state.
2. Initialize with `terraform init -backend-config=bucket=YOUR_STATE_BUCKET
   -backend-config=prefix=vautrin/staging`. Review `terraform plan` before apply.
3. Initially create the network, data services, registry, service accounts and
   secret metadata before launching application VMs. Use reviewed targeted
   bootstrap applies, then converge with a full plan/apply after provisioning.
4. Enable the Cloud SQL `vector` extension and create separate runtime/migration
   roles using `../scripts/bootstrap-db.sql` through a private administrative
   connection. Provide passwords through psql environment variables; never
   Terraform variables or command arguments. The runtime role must have
   `NOSUPERUSER NOBYPASSRLS NOCREATEDB`; do not serve traffic as the migration role.
5. Write JSON string-valued environment maps to the three Secret Manager secrets
   shown by `runtime_secret_ids`, using `gcloud secrets versions add --data-file`.
   Populate files outside the checkout with mode 0600, then remove them after
   upload. API/worker receive `DATABASE_URL` for `vautrin_app`; only migrator gets
   `DATABASE_MIGRATION_URL`. Each VM can read only its own environment and API/worker
   may read tenant provider secrets. The API can create/add tenant credential
   versions; the worker cannot change them.
6. Set `NODE_ENV=production`, `GCP_PROJECT_ID`, `JWT_SECRET`, `REDIS_URL=rediss://...`,
   `REDIS_TLS_CA_BASE64` from the public provider CA, `EMBEDDING_DIMENSIONS=1536` and
   `API_GLOBAL_PREFIX=api`. Set API `TRUSTED_ORIGINS` to the exact HTTPS origin.
   Set the proxy-hop count to match the tested GFE/X-Forwarded-For topology.
   Worker alone receives `OPENAI_API_KEY`. API receives Google OAuth Web client
   credentials with callback `https://DOMAIN/api/integrations/google-calendar/callback`.
7. Build/push immutable SHA-tagged images and run migrations before starting API
   and worker. Set the corresponding `*_image` inputs. Point DNS A at
   `load_balancer_ip` and wait for the managed TLS certificate to become active.

The startup artifact downloads an environment map into a protected temporary
file, pulls the image with its attached identity, drains the old container,
starts the replacement, checks its Docker health and publishes a revision guest
attribute. It cleans up the temporary environment and registry authentication.
No service-account key file is required. API port 3000 is reachable only from
GFE/health-check ranges; worker has no application ingress.

## Deployment and rollback

Use `../scripts/deploy.sh` from a clean, committed source tree with
`GCP_PROJECT_ID`, `GCP_REGION`, `GCP_ZONE`, `DEPLOY_PREFIX` (for example
`vautrin-staging`), `IMAGE_REGISTRY`, `FRONTEND_BUCKET` and `APPLICATION_ORIGIN`.
It pushes three SHA images, runs a disposable private migration VM with the
migrator identity, verifies both deployed revisions/health, archives the static
release, promotes it and runs topology smoke checks. A failed migration never
starts a new application rollout. A failed rollout requires operator rollback.

Rollback with `PROMOTE_ONLY=1 DEPLOY_SHA=PREVIOUS_SHA ../scripts/deploy.sh`.
This uses previous immutable images and the archived static release; it does
not rebuild old tags from current code. Migrations must remain compatible with
the previous release; destructive changes use expand/contract. Update Terraform
image inputs to match the promoted revision before the next infrastructure apply.

Enable GitHub federation only after supplying immutable repository/owner IDs
and the allowed branch. In the protected `staging` GitHub environment set
`GCP_PROJECT_ID`, `GCP_REGION`, `GCP_ZONE`, `DEPLOY_PREFIX`, `IMAGE_REGISTRY`,
`FRONTEND_BUCKET`, `APPLICATION_ORIGIN`, `GCP_WORKLOAD_IDENTITY_PROVIDER` and
`GCP_DEPLOY_SERVICE_ACCOUNT` repository/environment variables. The manual workflow
requires a full release SHA belonging to its selected branch and runs no Terraform
apply. Configure environment approval and pass CI before promoting a release. The staging workflow uses a protected GitHub environment.
Use the same artifacts for production after successful staging and explicit
release approval. Early single-VM rollouts have an outage while containers restart;
move API to a MIG when the uptime requirement demands redundancy.

## Static routes and smoke tests

The URL map explicitly rewrites known frontend routes to generated index objects,
and sends `/api` and `/api/*` to Nest. Missing assets stay 404. Security headers
are on the backend bucket; HTML caches briefly and hashed Nuxt assets immutably.
`../scripts/smoke.mjs https://DOMAIN` checks routing/readiness/headers. Supplying
`SMOKE_OWNER_EMAIL` and `SMOKE_OWNER_PASSWORD` additionally checks login, Secure
HttpOnly cookie rotation and logout using a dedicated staging identity.

## Release evidence still required on GCP

Configuration validation is separate from an applied staging smoke test. Record
the project/revision, HTTPS routing/deep-link results, cookie/origin/IP behavior,
Cloud SQL runtime RLS flags, Redis TLS/CA verification, provider sandbox smoke,
worker reconciliation after Redis loss, restore drill and rollback drill in the
release evidence. See `../runbooks/v0.3-readiness.md`. None of these live results
can be inferred from a mocked provider E2E or Terraform validate.
