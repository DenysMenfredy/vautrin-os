resource "google_service_account" "runtime" {
  for_each     = toset(["api", "worker", "migrator"])
  account_id   = "${local.prefix}-${each.key}"
  display_name = "${local.prefix} ${each.key} runtime"
  depends_on   = [google_project_service.services]
}
resource "google_project_iam_member" "logs" {
  for_each = google_service_account.runtime
  project  = var.project_id
  role     = "roles/logging.logWriter"
  member   = "serviceAccount:${each.value.email}"
}
resource "google_project_iam_member" "metrics" {
  for_each = google_service_account.runtime
  project  = var.project_id
  role     = "roles/monitoring.metricWriter"
  member   = "serviceAccount:${each.value.email}"
}
resource "google_artifact_registry_repository_iam_member" "pull" {
  for_each   = google_service_account.runtime
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${each.value.email}"
}
resource "google_secret_manager_secret" "runtime_environment" {
  for_each  = google_service_account.runtime
  secret_id = "${local.prefix}-${each.key}-environment"
  replication {
    auto {}
  }
}
resource "google_secret_manager_secret_iam_member" "runtime_environment" {
  for_each  = google_service_account.runtime
  secret_id = google_secret_manager_secret.runtime_environment[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${each.value.email}"
}
resource "google_project_iam_member" "tenant_secret_reader" {
  for_each = toset(["api", "worker"])
  project  = var.project_id
  role     = "roles/secretmanager.secretAccessor"
  member   = "serviceAccount:${google_service_account.runtime[each.key].email}"
  condition {
    title      = "TenantProviderCredentialsOnly"
    expression = "resource.name.startsWith('projects/${data.google_project.current.number}/secrets/vautrin-tenant-')"

  }
}
resource "google_project_iam_custom_role" "secret_creator" {
  role_id     = "vautrinSecretCreator${title(var.environment)}"
  title       = "Vautrin provider secret creation"
  permissions = ["secretmanager.secrets.create"]
}
resource "google_project_iam_custom_role" "secret_versions" {
  role_id     = "vautrinSecretVersions${title(var.environment)}"
  title       = "Vautrin provider credential versions"
  permissions = ["secretmanager.secrets.get", "secretmanager.versions.add"]
}
resource "google_project_iam_member" "secret_creator" {
  project = var.project_id
  role    = google_project_iam_custom_role.secret_creator.id
  member  = "serviceAccount:${google_service_account.runtime["api"].email}"
}
resource "google_project_iam_member" "secret_versions" {
  project = var.project_id
  role    = google_project_iam_custom_role.secret_versions.id
  member  = "serviceAccount:${google_service_account.runtime["api"].email}"
  condition {
    title      = "TenantProviderCredentialsOnly"
    expression = "resource.name.startsWith('projects/${data.google_project.current.number}/secrets/vautrin-tenant-')"

  }
}
