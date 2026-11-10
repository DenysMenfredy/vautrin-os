resource "google_storage_bucket" "admin" {
  count                       = var.admin_domain == "" ? 0 : 1
  name                        = "${var.project_id}-${local.prefix}-admin"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false
  versioning { enabled = true }
}
resource "google_storage_bucket_iam_member" "admin_static_public" {
  count  = var.admin_domain == "" ? 0 : 1
  bucket = google_storage_bucket.admin[0].name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}
resource "google_compute_backend_bucket" "admin" {
  count       = var.admin_domain == "" ? 0 : 1
  name        = "${local.prefix}-admin-backend"
  bucket_name = google_storage_bucket.admin[0].name
  enable_cdn  = true
  custom_response_headers = [
    "X-Content-Type-Options: nosniff", "X-Frame-Options: DENY", "Referrer-Policy: no-referrer",
    "Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    "Permissions-Policy: camera=(), microphone=(), geolocation=()"
  ]
  cdn_policy { cache_mode = "USE_ORIGIN_HEADERS" }
}
