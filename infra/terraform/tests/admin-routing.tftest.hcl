mock_provider "google" {
  mock_data "google_project" {
    defaults = { number = "123456789012" }
  }
  mock_data "google_compute_image" {
    defaults = { self_link = "https://www.googleapis.com/compute/v1/projects/debian-cloud/global/images/debian-12-test" }
  }
}
mock_resource "google_compute_network" {
  defaults = {
    id        = "projects/vautrin-admin-test/global/networks/vautrin-staging-network"
    self_link = "https://www.googleapis.com/compute/v1/projects/vautrin-admin-test/global/networks/vautrin-staging-network"
  }
}
variables {
  project_id      = "vautrin-admin-test"
  region          = "us-central1"
  zone            = "us-central1-a"
  environment     = "staging"
  domain          = "app.example.com"
  api_image       = "us-central1-docker.pkg.dev/vautrin-admin-test/runtime/api:abcdef0"
  worker_image    = "us-central1-docker.pkg.dev/vautrin-admin-test/runtime/worker:abcdef0"
  migration_image = "us-central1-docker.pkg.dev/vautrin-admin-test/runtime/migrate:abcdef0"
}
run "separate_admin_host" {
  command = apply
  variables { admin_domain = "admin.example.com" }
  assert {
    condition     = length(google_storage_bucket.admin) == 1 && google_storage_bucket.admin[0].name != google_storage_bucket.frontend.name
    error_message = "Admin must have an independent static bucket."
  }
  assert {
    condition     = contains(google_compute_managed_ssl_certificate.frontend.managed[0].domains, "admin.example.com")
    error_message = "Admin hostname requires managed TLS."
  }
  assert {
    condition     = length([for host in google_compute_url_map.frontend.host_rule : host if host.path_matcher == "platform-admin" && contains(host.hosts, "admin.example.com")]) == 1
    error_message = "Admin requests must select their own host matcher."
  }
  assert {
    condition     = alltrue([for matcher in google_compute_url_map.frontend.path_matcher : length([for route in matcher.route_rules : route if route.priority == 1 && route.service == google_compute_backend_service.api.id]) == 1 if matcher.name == "platform-admin"])
    error_message = "Admin API routing must precede SPA fallback."
  }
  assert {
    condition     = alltrue([for matcher in google_compute_url_map.frontend.path_matcher : length([for route in matcher.route_rules : route if route.priority >= 30 && try(route.route_action[0].url_rewrite[0].path_template_rewrite == "/200.html", false)]) == 2 if matcher.name == "platform-admin"])
    error_message = "User/tenant deep links must rewrite the entire captured path to the SPA shell."
  }
}
run "admin_disabled" {
  command = apply
  variables { admin_domain = "" }
  assert {
    condition     = length(google_storage_bucket.admin) == 0 && length(google_compute_backend_bucket.admin) == 0
    error_message = "Existing deployments may omit the admin frontend."
  }
}
