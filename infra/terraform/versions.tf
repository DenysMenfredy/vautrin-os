terraform {
  required_version = ">= 1.13.0, < 2.0.0"
  required_providers {
    google = {
      source = "hashicorp/google", version = "~> 7.0"
    }

  }
  # Configure an isolated, versioned, access-restricted GCS state bucket at init.
  backend "gcs" {}
}
provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}
data "google_project" "current" {
  project_id = var.project_id
}
locals {
  prefix = "${var.name}-${var.environment}"
  origin = "https://${var.domain}"
}
resource "google_project_service" "services" {
  for_each           = toset(["compute.googleapis.com", "sqladmin.googleapis.com", "redis.googleapis.com", "servicenetworking.googleapis.com", "artifactregistry.googleapis.com", "secretmanager.googleapis.com", "logging.googleapis.com", "monitoring.googleapis.com", "iam.googleapis.com", "iamcredentials.googleapis.com", "sts.googleapis.com"])
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
