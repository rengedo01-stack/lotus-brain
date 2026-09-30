resource "google_monitoring_uptime_check_config" "web" {
  count = var.enable_external_uptime_monitoring ? 1 : 0

  project            = var.project_id
  display_name       = "${var.system_name}-${var.environment}-web-uptime"
  checker_type       = "STATIC_IP_CHECKERS"
  period             = "300s"
  timeout            = "10s"
  log_check_failures = true

  monitored_resource {
    type = "uptime_url"

    labels = {
      project_id = var.project_id
      host       = local.production_hostname
    }
  }

  http_check {
    path           = "/"
    port           = 443
    request_method = "GET"
    use_ssl        = true
    validate_ssl   = true
  }

  depends_on = [google_project_service.required["monitoring.googleapis.com"]]
}

resource "google_monitoring_uptime_check_config" "api" {
  count = var.enable_external_uptime_monitoring ? 1 : 0

  project            = var.project_id
  display_name       = "${var.system_name}-${var.environment}-api-uptime"
  checker_type       = "STATIC_IP_CHECKERS"
  period             = "300s"
  timeout            = "10s"
  log_check_failures = true

  monitored_resource {
    type = "uptime_url"

    labels = {
      project_id = var.project_id
      host       = local.production_hostname
    }
  }

  http_check {
    path           = "/api/v1/health"
    port           = 443
    request_method = "GET"
    use_ssl        = true
    validate_ssl   = true
  }

  content_matchers {
    content = "ok"
    matcher = "MATCHES_JSON_PATH"

    json_path_matcher {
      json_path    = "$.status"
      json_matcher = "EXACT_MATCH"
    }
  }

  depends_on = [google_project_service.required["monitoring.googleapis.com"]]
}

resource "google_monitoring_alert_policy" "web_uptime" {
  count = var.enable_external_uptime_monitoring ? 1 : 0

  project               = var.project_id
  display_name          = "${var.system_name}-${var.environment}-web-uptime-failure"
  combiner              = "OR"
  severity              = "CRITICAL"
  notification_channels = var.monitoring_notification_channel_ids

  conditions {
    display_name = "At least two uptime checkers cannot reach the Web origin"

    condition_threshold {
      filter                  = "metric.type = \"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type = \"uptime_url\" AND metric.label.\"check_id\" = \"${google_monitoring_uptime_check_config.web[0].uptime_check_id}\""
      comparison              = "COMPARISON_GT"
      threshold_value         = 1
      duration                = "60s"
      evaluation_missing_data = "EVALUATION_MISSING_DATA_NO_OP"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
      }
    }
  }

  alert_strategy {
    notification_rate_limit {
      period = "300s"
    }
  }

  documentation {
    mime_type = "text/markdown"
    content   = <<-EOT
      **Signal:** two or more public uptime checkers cannot reach the production Web origin.

      **Probable cause:** DNS, certificate, global load balancer, or Web Cloud Run availability.

      **First response:** verify the external HTTPS endpoint, Certificate Manager status, load balancer logs, and the Web Cloud Run revision.

      **Resource:** ${local.production_hostname}/

      **Severity:** P1 / CRITICAL.
    EOT
  }
}

resource "google_monitoring_alert_policy" "api_uptime" {
  count = var.enable_external_uptime_monitoring ? 1 : 0

  project               = var.project_id
  display_name          = "${var.system_name}-${var.environment}-api-uptime-failure"
  combiner              = "OR"
  severity              = "CRITICAL"
  notification_channels = var.monitoring_notification_channel_ids

  conditions {
    display_name = "At least two uptime checkers cannot reach the API health endpoint"

    condition_threshold {
      filter                  = "metric.type = \"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type = \"uptime_url\" AND metric.label.\"check_id\" = \"${google_monitoring_uptime_check_config.api[0].uptime_check_id}\""
      comparison              = "COMPARISON_GT"
      threshold_value         = 1
      duration                = "60s"
      evaluation_missing_data = "EVALUATION_MISSING_DATA_NO_OP"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
      }
    }
  }

  alert_strategy {
    notification_rate_limit {
      period = "300s"
    }
  }

  documentation {
    mime_type = "text/markdown"
    content   = <<-EOT
      **Signal:** two or more public uptime checkers cannot reach the API health endpoint or validate its JSON response.

      **Probable cause:** DNS, certificate, global load balancer, API Cloud Run availability, or API startup failure.

      **First response:** verify the external health endpoint, load balancer logs, and the API Cloud Run revision. This is a liveness check and does not prove database reachability.

      **Resource:** ${local.production_hostname}/api/v1/health

      **Severity:** P1 / CRITICAL.
    EOT
  }
}

resource "google_monitoring_alert_policy" "worker_availability" {
  project               = var.project_id
  display_name          = "${var.system_name}-${var.environment}-worker-unavailable"
  combiner              = "OR"
  severity              = "CRITICAL"
  notification_channels = var.monitoring_notification_channel_ids

  conditions {
    display_name = "Notification Worker Pool has fewer than one instance for five minutes"

    condition_threshold {
      filter                  = "metric.type = \"run.googleapis.com/container/instance_count\" AND resource.type = \"cloud_run_worker_pool\" AND resource.labels.project_id = \"${var.project_id}\" AND resource.labels.location = \"${var.region}\" AND resource.labels.worker_pool_name = \"${google_cloud_run_v2_worker_pool.notification.name}\""
      comparison              = "COMPARISON_LT"
      threshold_value         = 1
      duration                = "300s"
      evaluation_missing_data = "EVALUATION_MISSING_DATA_NO_OP"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_MAX"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  alert_strategy {
    notification_rate_limit {
      period = "300s"
    }
  }

  documentation {
    mime_type = "text/markdown"
    content   = <<-EOT
      **Signal:** the manually scaled notification Worker Pool has fewer than one instance for five minutes.

      **Probable cause:** failed rollout, container startup failure, or an unintended worker stop.

      **First response:** inspect the Worker Pool revision and logs, verify the pinned API-family image and Secret Manager references, then restore the reviewed Worker Pool configuration.

      **Resource:** ${google_cloud_run_v2_worker_pool.notification.name}

      **Severity:** P1 / CRITICAL.
    EOT
  }
}

locals {
  production_metric_alerts = {
    cloud_sql_disk = {
      display_name  = "${var.system_name}-${var.environment}-cloud-sql-disk-utilization"
      severity      = "CRITICAL"
      condition     = "Cloud SQL disk utilization exceeds 80 percent for ten minutes"
      filter        = "metric.type = \"cloudsql.googleapis.com/database/disk/utilization\" AND resource.type = \"cloudsql_database\" AND resource.labels.project_id = \"${var.project_id}\" AND resource.labels.database_id = \"${module.cloud_sql.instance_name}\""
      threshold     = 0.8
      duration      = "600s"
      rate_limit    = "3600s"
      aggregation   = null
      documentation = <<-EOT
        **Signal:** Cloud SQL disk utilization has exceeded 80 percent for ten minutes.

        **Probable cause:** database growth, backup/WAL growth, or unexpectedly large data retention.

        **First response:** inspect Cloud SQL storage growth and automatic-storage headroom. Do not reduce storage or delete data before confirming backup and PITR health.

        **Resource:** ${module.cloud_sql.instance_name}

        **Severity:** P1 / CRITICAL.
      EOT
    }
    cloud_sql_memory = {
      display_name  = "${var.system_name}-${var.environment}-cloud-sql-memory-utilization"
      severity      = "WARNING"
      condition     = "Cloud SQL memory utilization exceeds 90 percent for six hours"
      filter        = "metric.type = \"cloudsql.googleapis.com/database/memory/utilization\" AND resource.type = \"cloudsql_database\" AND resource.labels.project_id = \"${var.project_id}\" AND resource.labels.database_id = \"${module.cloud_sql.instance_name}\""
      threshold     = 0.9
      duration      = "21600s"
      rate_limit    = "21600s"
      aggregation   = null
      documentation = <<-EOT
        **Signal:** Cloud SQL memory utilization has exceeded 90 percent for six hours.

        **Probable cause:** sustained workload growth, connection pressure, or memory-heavy queries.

        **First response:** inspect Cloud SQL memory, connections, and query activity; schedule capacity or query remediation through the normal change process.

        **Resource:** ${module.cloud_sql.instance_name}

        **Severity:** P2 / WARNING.
      EOT
    }
    cloud_nat_allocation = {
      display_name = "${var.system_name}-${var.environment}-worker-nat-allocation-failure"
      severity     = "CRITICAL"
      condition    = "Worker Cloud NAT reports a port allocation failure"
      filter       = "metric.type = \"router.googleapis.com/nat/nat_allocation_failed\" AND resource.type = \"nat_gateway\" AND resource.labels.project_id = \"${var.project_id}\" AND resource.labels.region = \"${var.region}\" AND resource.labels.gateway_name = \"${google_compute_router_nat.worker_egress.name}\""
      threshold    = 0
      duration     = "0s"
      rate_limit   = "300s"
      aggregation = {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_COUNT_TRUE"
        cross_series_reducer = "REDUCE_SUM"
      }
      documentation = <<-EOT
        **Signal:** the dedicated Worker Cloud NAT cannot allocate a source port.

        **Probable cause:** exhausted NAT port allocation or an egress configuration fault.

        **First response:** inspect the dedicated Worker NAT metric and error logs; confirm the worker subnet is its only source and evaluate approved NAT capacity changes.

        **Resource:** ${google_compute_router_nat.worker_egress.name}

        **Severity:** P1 / CRITICAL.
      EOT
    }
    cloud_nat_packet_drop = {
      display_name = "${var.system_name}-${var.environment}-worker-nat-packet-drops"
      severity     = "WARNING"
      condition    = "Worker Cloud NAT drops packets for capacity or endpoint-independence reasons"
      filter       = "metric.type = \"router.googleapis.com/nat/dropped_sent_packets_count\" AND resource.type = \"nat_gateway\" AND resource.labels.project_id = \"${var.project_id}\" AND resource.labels.region = \"${var.region}\" AND resource.labels.gateway_name = \"${google_compute_router_nat.worker_egress.name}\" AND (metric.labels.reason = \"OUT_OF_RESOURCES\" OR metric.labels.reason = \"ENDPOINT_INDEPENDENCE_CONFLICT\")"
      threshold    = 0
      duration     = "0s"
      rate_limit   = "900s"
      aggregation = {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
      documentation = <<-EOT
        **Signal:** the dedicated Worker Cloud NAT dropped one or more packets in five minutes due to capacity or endpoint-independence conflict.

        **Probable cause:** NAT source-port pressure or incompatible egress connection behavior.

        **First response:** inspect NAT error logs and Worker SMTP delivery behavior; do not alter NAT scope beyond the worker subnet without a reviewed change.

        **Resource:** ${google_compute_router_nat.worker_egress.name}

        **Severity:** P2 / WARNING.
      EOT
    }
  }
}

resource "google_monitoring_alert_policy" "metric" {
  for_each = local.production_metric_alerts

  project               = var.project_id
  display_name          = each.value.display_name
  combiner              = "OR"
  severity              = each.value.severity
  notification_channels = var.monitoring_notification_channel_ids

  conditions {
    display_name = each.value.condition

    condition_threshold {
      filter                  = each.value.filter
      comparison              = "COMPARISON_GT"
      threshold_value         = each.value.threshold
      duration                = each.value.duration
      evaluation_missing_data = "EVALUATION_MISSING_DATA_NO_OP"

      dynamic "aggregations" {
        for_each = each.value.aggregation == null ? [] : [each.value.aggregation]

        content {
          alignment_period     = aggregations.value.alignment_period
          per_series_aligner   = aggregations.value.per_series_aligner
          cross_series_reducer = aggregations.value.cross_series_reducer
        }
      }
    }
  }

  alert_strategy {
    notification_rate_limit {
      period = each.value.rate_limit
    }
  }

  documentation {
    mime_type = "text/markdown"
    content   = each.value.documentation
  }
}

locals {
  # Certificate Manager exposes expiry logs at the project monitored resource.
  # This root currently manages one production certificate; revisit these filters
  # if multiple certificates are added to the project.
  production_log_alerts = {
    cloud_sql_oom = {
      display_name  = "${var.system_name}-${var.environment}-cloud-sql-postgres-oom"
      severity      = "CRITICAL"
      condition     = "Cloud SQL PostgreSQL worker process was killed by the OOM killer"
      auto_close    = "3600s"
      rate_limit    = "1800s"
      filter        = "resource.type = \"cloudsql_database\" AND resource.labels.project_id = \"${var.project_id}\" AND resource.labels.database_id = \"${module.cloud_sql.instance_name}\" AND textPayload =~ \"server process .* was terminated by signal 9: Killed\""
      documentation = <<-EOT
        **Signal:** Cloud SQL PostgreSQL logged an OOM-killed server process.

        **Probable cause:** a memory-intensive query or sustained database memory exhaustion.

        **First response:** assess database availability, inspect Cloud SQL memory and PostgreSQL logs, and preserve evidence before query or capacity remediation.

        **Resource:** ${module.cloud_sql.instance_name}

        **Severity:** P1 / CRITICAL.
      EOT
    }
    cloud_sql_backup_failure = {
      display_name  = "${var.system_name}-${var.environment}-cloud-sql-automated-backup-failure"
      severity      = "CRITICAL"
      condition     = "Cloud SQL automated backup did not complete successfully"
      auto_close    = "86400s"
      rate_limit    = "3600s"
      filter        = "log_id(\"cloudaudit.googleapis.com/system_event\") AND protoPayload.methodName = \"cloudsql.instances.automatedBackup\" AND protoPayload.resourceName = \"projects/${var.project_id}/instances/${module.cloud_sql.instance_name}\" AND resource.type = \"cloudsql_database\" AND (protoPayload.metadata.windowStatus = \"STATUS_FAILED\" OR protoPayload.metadata.windowStatus = \"STATUS_ATTEMPT_FAILED\" OR protoPayload.metadata.windowStatus = \"STATUS_SKIPPED\")"
      documentation = <<-EOT
        **Signal:** the Cloud SQL automated-backup system event reported a failed, attempt-failed, or skipped backup window.

        **Probable cause:** instance availability, backup-window conflict, policy restriction, or backup configuration error.

        **First response:** inspect the Cloud SQL system event metadata, confirm the last successful backup and PITR health, then resolve the reported cause before the next window.

        **Resource:** ${module.cloud_sql.instance_name}

        **Severity:** P1 / CRITICAL.
      EOT
    }
    certificate_expired = {
      display_name  = "${var.system_name}-${var.environment}-certificate-expired"
      severity      = "CRITICAL"
      condition     = "The production Certificate Manager certificate is expired"
      auto_close    = "86400s"
      rate_limit    = "3600s"
      filter        = "logName = \"projects/${var.project_id}/logs/certificatemanager.googleapis.com%2Fcertificates_expiry\" AND resource.type = \"certificatemanager.googleapis.com/Project\" AND jsonPayload.state = \"EXPIRED\""
      documentation = <<-EOT
        **Signal:** Certificate Manager reported an expired certificate in this production project.

        **Probable cause:** DNS authorization or certificate-renewal failure.

        **First response:** inspect Certificate Manager and the permanent DNS authorization CNAME. Do not remove or replace the CNAME during investigation.

        **Resource:** ${google_certificate_manager_certificate.production.name}

        **Severity:** P1 / CRITICAL.
      EOT
    }
    certificate_close_to_expiry = {
      display_name  = "${var.system_name}-${var.environment}-certificate-close-to-expiry"
      severity      = "WARNING"
      condition     = "The production Certificate Manager certificate is close to expiry"
      auto_close    = "86400s"
      rate_limit    = "86400s"
      filter        = "logName = \"projects/${var.project_id}/logs/certificatemanager.googleapis.com%2Fcertificates_expiry\" AND resource.type = \"certificatemanager.googleapis.com/Project\" AND jsonPayload.state = \"CLOSE_TO_EXPIRY\""
      documentation = <<-EOT
        **Signal:** Certificate Manager reported a certificate close to expiry in this production project.

        **Probable cause:** DNS authorization or certificate-renewal failure.

        **First response:** inspect Certificate Manager and verify the permanent DNS authorization CNAME remains exact and publicly resolvable.

        **Resource:** ${google_certificate_manager_certificate.production.name}

        **Severity:** P2 / WARNING.
      EOT
    }
  }
}

resource "google_monitoring_alert_policy" "log" {
  for_each = local.production_log_alerts

  project               = var.project_id
  display_name          = each.value.display_name
  combiner              = "OR"
  severity              = each.value.severity
  notification_channels = var.monitoring_notification_channel_ids

  conditions {
    display_name = each.value.condition

    condition_matched_log {
      filter = each.value.filter
    }
  }

  alert_strategy {
    auto_close = each.value.auto_close

    notification_rate_limit {
      period = each.value.rate_limit
    }
  }

  documentation {
    mime_type = "text/markdown"
    content   = each.value.documentation
  }
}
