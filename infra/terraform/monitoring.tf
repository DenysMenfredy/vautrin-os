resource "google_monitoring_uptime_check_config" "api" {
  display_name = "${local.prefix} API readiness"
  timeout      = "10s"
  period       = "60s"
  http_check {
    path         = "/api/health/ready"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }
  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id, host = var.domain
    }
  }
}
resource "google_monitoring_alert_policy" "api" {
  display_name          = "${local.prefix} API unavailable"
  combiner              = "OR"
  notification_channels = var.notification_channels
  conditions {
    display_name = "Readiness check fails"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.api.uptime_check_id}\""
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      duration        = "300s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_FRACTION_TRUE"
      }
      trigger {
        count = 1
      }

    }

  }
}
resource "google_monitoring_alert_policy" "runtime_errors" {
  display_name          = "${local.prefix} runtime failure"
  combiner              = "OR"
  notification_channels = var.notification_channels
  conditions {
    display_name = "Workflow or API exception"
    condition_matched_log {
      filter = "resource.type=\"gce_instance\" AND (textPayload:\"workflow.action.failed\" OR textPayload:\"http.exception\" OR jsonPayload.message.operation=\"workflow.action.failed\" OR jsonPayload.message.operation=\"http.exception\")"

    }

  }
  alert_strategy {
    notification_rate_limit {
      period = "300s"
    }
  }
}
