#!/usr/bin/env bash
set -euo pipefail
# Independent static artifact deployment. API migrations/release precede this.
: "${GCP_PROJECT_ID:?}" "${DEPLOY_PREFIX:?}" "${ADMIN_FRONTEND_BUCKET:?}" "${ADMIN_ORIGIN:?}" "${APPLICATION_ORIGIN:?}"
admin_sha="${DEPLOY_SHA:-$(git rev-parse HEAD)}"
[[ "$admin_sha" =~ ^[a-f0-9]{7,40}$ ]] || { echo 'DEPLOY_SHA must be a commit SHA' >&2; exit 1; }
if [ "${PROMOTE_ONLY:-0}" != 1 ]; then
  [ "$admin_sha" = "$(git rev-parse HEAD)" ] && [ -z "$(git status --porcelain)" ] || { echo 'Build from clean, committed release source' >&2; exit 1; }
  NUXT_PUBLIC_APPLICATION_BASE_URL="$APPLICATION_ORIGIN" pnpm --filter @vautrin/admin build:static
  gcloud storage rsync --recursive apps/admin/.output/public "gs://$ADMIN_FRONTEND_BUCKET/releases/$admin_sha" --cache-control='no-store'
fi
gcloud storage rsync --recursive "gs://$ADMIN_FRONTEND_BUCKET/releases/$admin_sha" "gs://$ADMIN_FRONTEND_BUCKET"
gcloud storage objects update "gs://$ADMIN_FRONTEND_BUCKET/_nuxt/**" --cache-control='public,max-age=31536000,immutable'
gcloud compute url-maps invalidate-cdn-cache "$DEPLOY_PREFIX-routing" --project "$GCP_PROJECT_ID" --path '/*' --host "${ADMIN_ORIGIN#https://}" --async
node infra/scripts/smoke-admin.mjs "$ADMIN_ORIGIN"
