resource "google_iam_workload_identity_pool" "github" {
  count                     = var.github_repository == "" ? 0 : 1
  workload_identity_pool_id = "${local.prefix}-github"
}
resource "google_iam_workload_identity_pool_provider" "github" {
  count                              = var.github_repository == "" ? 0 : 1
  workload_identity_pool_id          = google_iam_workload_identity_pool.github[0].workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  attribute_mapping = {
    "google.subject"                = "assertion.sub"
    "attribute.repository_id"       = "assertion.repository_id"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
  }
  attribute_condition = "assertion.repository_id == '${var.github_repository_id}' && assertion.repository_owner_id == '${var.github_owner_id}' && assertion.ref == 'refs/heads/${var.deployment_branch}'"
  oidc { issuer_uri = "https://token.actions.githubusercontent.com" }
}
resource "google_service_account" "deployment" {
  count      = var.github_repository == "" ? 0 : 1
  account_id = "${local.prefix}-deploy"
}
resource "google_service_account_iam_member" "federation" {
  count              = var.github_repository == "" ? 0 : 1
  service_account_id = google_service_account.deployment[0].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github[0].name}/attribute.repository_id/${var.github_repository_id}"
}
resource "google_service_account_iam_member" "deploy_runtime" {
  for_each           = var.github_repository == "" ? {} : google_service_account.runtime
  service_account_id = each.value.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployment[0].email}"
}
resource "google_project_iam_member" "deploy_compute" {
  count   = var.github_repository == "" ? 0 : 1
  project = var.project_id
  role    = "roles/compute.instanceAdmin.v1"
  member  = "serviceAccount:${google_service_account.deployment[0].email}"
}
resource "google_project_iam_custom_role" "deploy_cache" {
  count       = var.github_repository == "" ? 0 : 1
  role_id     = "vautrinCacheInvalidation${title(var.environment)}"
  title       = "Vautrin static release cache invalidation"
  permissions = ["compute.urlMaps.invalidateCache"]
}
resource "google_project_iam_member" "deploy_cache" {
  count   = var.github_repository == "" ? 0 : 1
  project = var.project_id
  role    = google_project_iam_custom_role.deploy_cache[0].id
  member  = "serviceAccount:${google_service_account.deployment[0].email}"
}
resource "google_storage_bucket_iam_member" "deploy" {
  count  = var.github_repository == "" ? 0 : 1
  bucket = google_storage_bucket.frontend.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.deployment[0].email}"
}
resource "google_artifact_registry_repository_iam_member" "deploy" {
  count      = var.github_repository == "" ? 0 : 1
  location   = var.region
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deployment[0].email}"
}
