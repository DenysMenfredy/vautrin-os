output "application_origin" {
  value = local.origin
}
output "load_balancer_ip" {
  value = google_compute_global_address.frontend.address
}
output "frontend_bucket" {
  value = google_storage_bucket.frontend.name
}
output "artifact_registry" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}
output "database_private_ip" {
  value = google_sql_database_instance.main.private_ip_address
}
output "redis_host" {
  value = google_redis_instance.main.host
}
output "redis_port" {
  value = google_redis_instance.main.port
}
output "redis_auth" {
  value     = google_redis_instance.main.auth_string
  sensitive = true
}
output "redis_ca" {
  value     = google_redis_instance.main.server_ca_certs
  sensitive = true
}
output "runtime_secret_ids" {
  value = {
    for key, secret in google_secret_manager_secret.runtime_environment : key => secret.secret_id
  }
}
output "runtime_instance_names" {
  value = {
    for key, vm in google_compute_instance.runtime : key => vm.name
  }
}
output "runtime_service_accounts" {
  value = {
    for key, sa in google_service_account.runtime : key => sa.email
  }
}
output "workload_identity_provider" { value = var.github_repository == "" ? null : google_iam_workload_identity_pool_provider.github[0].name }
output "deployment_service_account" { value = var.github_repository == "" ? null : google_service_account.deployment[0].email }
