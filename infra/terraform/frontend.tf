resource "google_storage_bucket" "frontend" {
  name                        = "${var.project_id}-${local.prefix}-web"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false
  versioning {
    enabled = true
  }
}
resource "google_storage_bucket_iam_member" "static_public" {
  bucket = google_storage_bucket.frontend.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}
resource "google_compute_backend_bucket" "frontend" {
  name        = "${local.prefix}-web-backend"
  bucket_name = google_storage_bucket.frontend.name
  enable_cdn  = true
  custom_response_headers = [
    "X-Content-Type-Options: nosniff", "X-Frame-Options: DENY", "Referrer-Policy: strict-origin-when-cross-origin",
    "Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    "Permissions-Policy: camera=(), microphone=(), geolocation=()"
  ]
  cdn_policy {
    cache_mode       = "USE_ORIGIN_HEADERS"
    negative_caching = false

  }
}
resource "google_compute_global_address" "frontend" {
  name = "${local.prefix}-web-ip"
}
resource "google_compute_managed_ssl_certificate" "frontend" {
  name = "${local.prefix}-tls"
  managed {
    domains = [var.domain]
  }
}
resource "google_compute_url_map" "frontend" {
  name            = "${local.prefix}-routing"
  default_service = google_compute_backend_bucket.frontend.id
  host_rule {
    hosts        = [var.domain]
    path_matcher = "application"
  }
  path_matcher {
    name            = "application"
    default_service = google_compute_backend_bucket.frontend.id
    path_rule {
      paths   = ["/api", "/api/*"]
      service = google_compute_backend_service.api.id
    }
    dynamic "path_rule" {
      for_each = toset(["", "login", "invitation", "leads", "conversations", "appointments", "workflows", "agents", "settings"])
      content {
        paths   = path_rule.value == "" ? ["/"] : ["/${path_rule.value}", "/${path_rule.value}/"]
        service = google_compute_backend_bucket.frontend.id
        route_action {
          url_rewrite {
            path_prefix_rewrite = path_rule.value == "" ? "/index.html" : "/${path_rule.value}/index.html"
          }
        }

      }

    }

  }
  test {
    host    = var.domain
    path    = "/api/auth/refresh"
    service = google_compute_backend_service.api.id
  }
  test {
    host    = var.domain
    path    = "/settings"
    service = google_compute_backend_bucket.frontend.id
  }
  test {
    host    = var.domain
    path    = "/missing.js"
    service = google_compute_backend_bucket.frontend.id
  }
}
resource "google_compute_target_https_proxy" "frontend" {
  name             = "${local.prefix}-https"
  url_map          = google_compute_url_map.frontend.id
  ssl_certificates = [google_compute_managed_ssl_certificate.frontend.id]
}
resource "google_compute_global_forwarding_rule" "https" {
  name                  = "${local.prefix}-https"
  ip_address            = google_compute_global_address.frontend.id
  port_range            = "443"
  target                = google_compute_target_https_proxy.frontend.id
  load_balancing_scheme = "EXTERNAL_MANAGED"
}
resource "google_compute_url_map" "redirect" {
  name = "${local.prefix}-https-redirect"
  default_url_redirect {
    https_redirect         = true
    strip_query            = false
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
  }
}
resource "google_compute_target_http_proxy" "redirect" {
  name    = "${local.prefix}-http"
  url_map = google_compute_url_map.redirect.id
}
resource "google_compute_global_forwarding_rule" "http" {
  name                  = "${local.prefix}-http"
  ip_address            = google_compute_global_address.frontend.id
  port_range            = "80"
  target                = google_compute_target_http_proxy.redirect.id
  load_balancing_scheme = "EXTERNAL_MANAGED"
}
