#!/usr/bin/env bash
set -euo pipefail
# Explicit environment inputs. Secret VALUES never pass through this script.
: "${GCP_PROJECT_ID:?}" "${GCP_REGION:?}" "${GCP_ZONE:?}" "${DEPLOY_PREFIX:?}" "${IMAGE_REGISTRY:?}" "${FRONTEND_BUCKET:?}" "${APPLICATION_ORIGIN:?}"
deployment_sha="${DEPLOY_SHA:-$(git rev-parse HEAD)}"
[[ "$deployment_sha" =~ ^[a-f0-9]{7,40}$ ]] || { echo 'DEPLOY_SHA must be a commit SHA' >&2; exit 1; }
deployment_work=$(mktemp -d)
trap 'rm -rf "$deployment_work"' EXIT
gcloud auth configure-docker "$GCP_REGION-docker.pkg.dev" --quiet
if [ "${PROMOTE_ONLY:-0}" != 1 ]; then
  [ "$deployment_sha" = "$(git rev-parse HEAD)" ] || { echo 'Build source does not match DEPLOY_SHA' >&2; exit 1; }
  [ -z "$(git status --porcelain)" ] || { echo 'Commit the release source before building' >&2; exit 1; }
for service in api worker migrate; do
  dockerfile="apps/$service/Dockerfile"
  if [ "$service" = migrate ]; then dockerfile=packages/database/Dockerfile; fi
  docker build -f "$dockerfile" -t "$IMAGE_REGISTRY/$service:$deployment_sha" .
  docker push "$IMAGE_REGISTRY/$service:$deployment_sha"
done
fi
python3 infra/scripts/render-startup.py --project "$GCP_PROJECT_ID" --secret-resource "projects/$GCP_PROJECT_ID/secrets/$DEPLOY_PREFIX-migrator-environment" --image "$IMAGE_REGISTRY/migrate:$deployment_sha" --role migrator --output "$deployment_work/migrate.sh"
migration_instance="$DEPLOY_PREFIX-migrate-${deployment_sha:0:8}"
gcloud compute instances create "$migration_instance" --project "$GCP_PROJECT_ID" --zone "$GCP_ZONE" --machine-type e2-small --image-family debian-12 --image-project debian-cloud --subnet "$DEPLOY_PREFIX-subnet" --no-address --service-account "$DEPLOY_PREFIX-migrator@$GCP_PROJECT_ID.iam.gserviceaccount.com" --scopes cloud-platform --metadata enable-guest-attributes=TRUE,enable-oslogin=TRUE,block-project-ssh-keys=TRUE --metadata-from-file "startup-script=$deployment_work/migrate.sh"
migration_status=''
for attempt in {1..90}; do
  migration_status=$(gcloud compute instances get-guest-attributes "$migration_instance" --project "$GCP_PROJECT_ID" --zone "$GCP_ZONE" --query-path vautrin/migration-status --format=json 2>/dev/null | python3 infra/scripts/read-guest-value.py vautrin migration-status 2>/dev/null || true)
  if [ "$migration_status" = success ] || [ "$migration_status" = failed ]; then break; fi
  sleep 10
done
if [ "$migration_status" != success ]; then echo "Migration failed or timed out; inspect $migration_instance. Applications have not rolled forward." >&2; exit 1; fi
gcloud compute instances delete "$migration_instance" --project "$GCP_PROJECT_ID" --zone "$GCP_ZONE" --quiet
for service in api worker; do
  python3 infra/scripts/render-startup.py --project "$GCP_PROJECT_ID" --secret-resource "projects/$GCP_PROJECT_ID/secrets/$DEPLOY_PREFIX-$service-environment" --image "$IMAGE_REGISTRY/$service:$deployment_sha" --role "$service" --output "$deployment_work/$service.sh"
  gcloud compute instances add-metadata "$DEPLOY_PREFIX-$service" --project "$GCP_PROJECT_ID" --zone "$GCP_ZONE" --metadata-from-file "startup-script=$deployment_work/$service.sh"
  gcloud compute instances reset "$DEPLOY_PREFIX-$service" --project "$GCP_PROJECT_ID" --zone "$GCP_ZONE" --quiet
done
for service in api worker; do
  observed=''
  for attempt in {1..90}; do
    observed=$(gcloud compute instances get-guest-attributes "$DEPLOY_PREFIX-$service" --project "$GCP_PROJECT_ID" --zone "$GCP_ZONE" --query-path "vautrin/release-$service" --format=json 2>/dev/null | python3 infra/scripts/read-guest-value.py vautrin "release-$service" 2>/dev/null || true)
    if [ "$observed" = "$IMAGE_REGISTRY/$service:$deployment_sha" ]; then break; fi
    sleep 10
  done
  [ "$observed" = "$IMAGE_REGISTRY/$service:$deployment_sha" ] || { echo "$service did not become healthy on the requested image" >&2; exit 1; }
done
curl -fsS "$APPLICATION_ORIGIN/api/health/ready" >/dev/null
if [ "${PROMOTE_ONLY:-0}" != 1 ]; then
  pnpm --filter @vautrin/web build:static
  gcloud storage rsync --recursive apps/web/.output/public "gs://$FRONTEND_BUCKET/releases/$deployment_sha" --cache-control='public,max-age=60'
fi
gcloud storage rsync --recursive "gs://$FRONTEND_BUCKET/releases/$deployment_sha" "gs://$FRONTEND_BUCKET"
gcloud storage objects update "gs://$FRONTEND_BUCKET/_nuxt/**" --cache-control='public,max-age=31536000,immutable'
gcloud compute url-maps invalidate-cdn-cache "$DEPLOY_PREFIX-routing" --project "$GCP_PROJECT_ID" --path '/*' --async
node infra/scripts/smoke.mjs "$APPLICATION_ORIGIN"
