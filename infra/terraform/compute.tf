data "google_compute_image" "debian" {
  family  = "debian-12"
  project = "debian-cloud"
}
resource "google_compute_instance" "runtime" {
  for_each                  = toset(["api", "worker"])
  name                      = "${local.prefix}-${each.key}"
  zone                      = var.zone
  machine_type              = var.machine_type
  allow_stopping_for_update = true
  boot_disk {
    initialize_params {
      image = data.google_compute_image.debian.self_link
      size  = 20
    }

  }
  network_interface {
    subnetwork = google_compute_subnetwork.main.id
  }
  service_account {
    email  = google_service_account.runtime[each.key].email
    scopes = ["https://www.googleapis.com/auth/cloud-platform"]

  }
  metadata = {
    enable-oslogin          = "TRUE"
    block-project-ssh-keys  = "TRUE"
    enable-guest-attributes = "TRUE"

  }
  metadata_startup_script = templatefile("${path.module}/startup.sh.tftpl", {
    image           = each.key == "api" ? var.api_image : var.worker_image
    secret_resource = google_secret_manager_secret.runtime_environment[each.key].id
    project         = var.project_id
    role            = each.key

  })
  depends_on = [google_compute_router_nat.egress, google_secret_manager_secret_iam_member.runtime_environment, google_project_iam_member.logs]
}
resource "google_compute_instance_group" "api" {
  name      = "${local.prefix}-api-group"
  zone      = var.zone
  instances = [google_compute_instance.runtime["api"].self_link]
  named_port {
    name = "http"
    port = 3000
  }
}
resource "google_compute_health_check" "api" {
  name               = "${local.prefix}-api-health"
  check_interval_sec = 10
  timeout_sec        = 5
  http_health_check {
    port         = 3000
    request_path = "/api/health/ready"
  }
}
resource "google_compute_backend_service" "api" {
  name                  = "${local.prefix}-api-backend"
  protocol              = "HTTP"
  port_name             = "http"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  health_checks         = [google_compute_health_check.api.id]
  timeout_sec           = 60
  backend {
    group = google_compute_instance_group.api.id
  }
  custom_response_headers = ["Cache-Control: no-store"]
  log_config {
    enable      = true
    sample_rate = 1.0
  }
}
