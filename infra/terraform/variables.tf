variable "project_id" {
  type = string
}
variable "region" {
  type = string
}
variable "zone" {
  type = string
}
variable "domain" {
  type = string
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]+[a-z0-9]$", var.domain))
    error_message = "Use an application hostname without a scheme or path."

  }
}
variable "environment" {
  type = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "Use staging or production in separate projects."

  }
}
variable "name" {
  type    = string
  default = "vautrin"
}
variable "api_image" {
  type = string
  validation {
    condition     = can(regex("^[a-z0-9-]+-docker[.]pkg[.]dev/[a-z0-9-]+/[a-z0-9-]+/[a-z0-9-]+:[a-f0-9]{7,40}$", var.api_image))
    error_message = "Use an Artifact Registry image tagged with its commit SHA."
  }
}
variable "worker_image" {
  type = string
  validation {
    condition     = can(regex("^[a-z0-9-]+-docker[.]pkg[.]dev/[a-z0-9-]+/[a-z0-9-]+/[a-z0-9-]+:[a-f0-9]{7,40}$", var.worker_image))
    error_message = "Use an Artifact Registry image tagged with its commit SHA."
  }
}
variable "migration_image" {
  type = string
  validation {
    condition     = can(regex("^[a-z0-9-]+-docker[.]pkg[.]dev/[a-z0-9-]+/[a-z0-9-]+/[a-z0-9-]+:[a-f0-9]{7,40}$", var.migration_image))
    error_message = "Use an Artifact Registry image tagged with its commit SHA."
  }
}
variable "machine_type" {
  type    = string
  default = "e2-small"
}
variable "database_tier" {
  type    = string
  default = "db-custom-1-3840"
}
variable "database_ha" {
  type    = bool
  default = false
}
variable "redis_memory_gb" {
  type    = number
  default = 1
}
variable "github_repository" {
  type    = string
  default = ""
}
variable "deployment_branch" {
  type    = string
  default = "main"
}
variable "notification_channels" {
  type    = list(string)
  default = []
}
variable "github_repository_id" {
  type    = string
  default = ""
  validation {
    condition     = var.github_repository == "" || can(regex("^[0-9]+$", var.github_repository_id))
    error_message = "Supply the immutable GitHub repository ID when enabling federation."
  }
}
variable "github_owner_id" {
  type    = string
  default = ""
  validation {
    condition     = var.github_repository == "" || can(regex("^[0-9]+$", var.github_owner_id))
    error_message = "Supply the immutable GitHub owner ID when enabling federation."
  }
}
