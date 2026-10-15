resource "google_sql_database_instance" "main" {
  name                = "${local.prefix}-postgres"
  region              = var.region
  database_version    = "POSTGRES_17"
  deletion_protection = true
  settings {
    tier              = var.database_tier
    availability_type = var.database_ha ? "REGIONAL" : "ZONAL"
    disk_autoresize   = true
    disk_size         = 20
    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.main.id
      ssl_mode        = "ENCRYPTED_ONLY"

    }
    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "03:00"
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 7
      }

    }

  }
  depends_on = [google_service_networking_connection.private_services]
}
resource "google_sql_database" "main" {
  name     = "vautrin"
  instance = google_sql_database_instance.main.name
}
resource "google_redis_instance" "main" {
  name                    = "${local.prefix}-redis"
  region                  = var.region
  tier                    = "STANDARD_HA"
  memory_size_gb          = var.redis_memory_gb
  redis_version           = "REDIS_7_2"
  authorized_network      = google_compute_network.main.id
  connect_mode            = "PRIVATE_SERVICE_ACCESS"
  auth_enabled            = true
  transit_encryption_mode = "SERVER_AUTHENTICATION"
  depends_on              = [google_service_networking_connection.private_services]
}
resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = local.prefix
  format        = "DOCKER"
  docker_config { immutable_tags = true }
  depends_on = [google_project_service.services]
}
