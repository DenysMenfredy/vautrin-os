resource "google_compute_network" "main" {
  name                    = "${local.prefix}-network"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.services]
}
resource "google_compute_subnetwork" "main" {
  name                     = "${local.prefix}-subnet"
  region                   = var.region
  network                  = google_compute_network.main.id
  ip_cidr_range            = "10.40.0.0/24"
  private_ip_google_access = true
}
resource "google_compute_global_address" "private_services" {
  name          = "${local.prefix}-private-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.main.id
}
resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.main.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]
}
resource "google_compute_router" "main" {
  name    = "${local.prefix}-router"
  network = google_compute_network.main.id
  region  = var.region
}
resource "google_compute_router_nat" "egress" {
  name                               = "${local.prefix}-egress"
  router                             = google_compute_router.main.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
}
resource "google_compute_firewall" "api_ingress" {
  name                    = "${local.prefix}-api-ingress"
  network                 = google_compute_network.main.id
  source_ranges           = ["35.191.0.0/16", "130.211.0.0/22"]
  target_service_accounts = [google_service_account.runtime["api"].email]
  allow {
    protocol = "tcp"
    ports    = ["3000"]
  }
}
resource "google_compute_firewall" "iap_ssh" {
  name                    = "${local.prefix}-iap-ssh"
  network                 = google_compute_network.main.id
  source_ranges           = ["35.235.240.0/20"]
  target_service_accounts = [for sa in google_service_account.runtime : sa.email]
  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}
