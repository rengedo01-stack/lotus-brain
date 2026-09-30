variable "project_id" {
  description = "Existing owner-managed Google Cloud project ID."
  type        = string
}

variable "region" {
  description = "Regional location for Lotus BRAIN production infrastructure."
  type        = string
  default     = "asia-northeast1"
}

variable "environment" {
  description = "Deployment environment label."
  type        = string
  default     = "production"
}

variable "system_name" {
  description = "System label and resource-name prefix."
  type        = string
  default     = "lotus-brain"
}

variable "app_subnet_cidr" {
  description = "Application subnet CIDR."
  type        = string
  default     = "10.70.0.0/24"
}

variable "worker_subnet_cidr" {
  description = "Worker subnet CIDR."
  type        = string
  default     = "10.70.1.0/24"
}

variable "private_services_access_cidr" {
  description = "Reserved Private Services Access CIDR."
  type        = string
  default     = "10.70.16.0/20"
}

variable "cloud_sql_backup_location" {
  description = "Owner-approved Cloud SQL backup location, supplied explicitly for production."
  type        = string

  validation {
    condition     = length(trimspace(var.cloud_sql_backup_location)) > 0
    error_message = "cloud_sql_backup_location must be an explicit, non-empty Cloud SQL backup location."
  }
}

variable "cloud_sql_maintenance_day" {
  description = "Cloud SQL weekly maintenance day in UTC (1 is Monday and 7 is Sunday)."
  type        = number

  validation {
    condition     = var.cloud_sql_maintenance_day >= 1 && var.cloud_sql_maintenance_day <= 7
    error_message = "cloud_sql_maintenance_day must be between 1 (Monday) and 7 (Sunday)."
  }
}

variable "cloud_sql_maintenance_hour" {
  description = "Cloud SQL maintenance hour in UTC."
  type        = number

  validation {
    condition     = var.cloud_sql_maintenance_hour >= 0 && var.cloud_sql_maintenance_hour <= 23
    error_message = "cloud_sql_maintenance_hour must be between 0 and 23 UTC."
  }
}

variable "cloud_run_web_image" {
  description = "Initial immutable Web image digest. Subsequent image rollouts are owned by the release process."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+-docker\\.pkg\\.dev/[^@:/]+/[^@:/]+/web@sha256:[a-f0-9]{64}$", var.cloud_run_web_image))
    error_message = "cloud_run_web_image must be an Artifact Registry Web image with an immutable lowercase SHA-256 digest and no tag."
  }
}

variable "cloud_run_api_image" {
  description = "Initial immutable API-family image digest shared by the API service and migration Job. Subsequent image rollouts are owned by the release process."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+-docker\\.pkg\\.dev/[^@:/]+/[^@:/]+/api@sha256:[a-f0-9]{64}$", var.cloud_run_api_image))
    error_message = "cloud_run_api_image must be an Artifact Registry API image with an immutable lowercase SHA-256 digest and no tag."
  }
}

variable "production_web_base_url" {
  description = "Approved HTTPS origin for the production Web application."
  type        = string

  validation {
    condition     = can(regex("^https://[^/?#]+/?$", var.production_web_base_url))
    error_message = "production_web_base_url must be an HTTPS origin without a path, query, or fragment."
  }
}

variable "monitoring_notification_channel_ids" {
  description = "Operator-owned Cloud Monitoring notification channel resource IDs for production alerts."
  type        = list(string)

  validation {
    condition = length(var.monitoring_notification_channel_ids) > 0 && alltrue([
      for channel_id in var.monitoring_notification_channel_ids : can(regex("^projects/[^/]+/notificationChannels/[0-9]+$", channel_id))
    ])
    error_message = "monitoring_notification_channel_ids must be a non-empty list of projects/<project>/notificationChannels/<numeric-id> resource IDs."
  }
}

variable "enable_external_uptime_monitoring" {
  description = "Creates public Web and API uptime checks only after DNS cutover, certificate activation, and smoke checks are complete."
  type        = bool
  default     = false
}

variable "webauthn_rp_name" {
  description = "Approved WebAuthn relying-party display name."
  type        = string

  validation {
    condition     = length(trimspace(var.webauthn_rp_name)) > 0
    error_message = "webauthn_rp_name must be non-empty."
  }
}

variable "webauthn_rp_id" {
  description = "Approved WebAuthn relying-party ID."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$", var.webauthn_rp_id))
    error_message = "webauthn_rp_id must be a lowercase registrable domain suffix."
  }
}

variable "smtp_host" {
  description = "Owner-approved SMTP hostname for production notification delivery."
  type        = string

  validation {
    condition     = length(trimspace(var.smtp_host)) > 0
    error_message = "smtp_host must be non-empty."
  }
}

variable "smtp_port" {
  description = "Owner-approved SMTP TCP port."
  type        = number

  validation {
    condition     = var.smtp_port >= 1 && var.smtp_port <= 65535 && floor(var.smtp_port) == var.smtp_port
    error_message = "smtp_port must be an integer between 1 and 65535."
  }
}

variable "smtp_secure" {
  description = "Whether the SMTP provider requires implicit TLS."
  type        = bool
}

variable "smtp_from" {
  description = "Owner-approved sender address for production notification delivery."
  type        = string

  validation {
    condition     = length(trimspace(var.smtp_from)) > 0
    error_message = "smtp_from must be non-empty."
  }
}

variable "database_url_secret_version" {
  description = "Existing numeric Secret Manager version for DATABASE_URL. The secret value remains outside Terraform."
  type        = string

  validation {
    condition     = can(regex("^[1-9][0-9]*$", var.database_url_secret_version))
    error_message = "database_url_secret_version must be an existing positive numeric version, not latest."
  }
}

variable "smtp_user_secret_version" {
  description = "Existing numeric Secret Manager version for SMTP_USER. The secret value remains outside Terraform."
  type        = string

  validation {
    condition     = can(regex("^[1-9][0-9]*$", var.smtp_user_secret_version))
    error_message = "smtp_user_secret_version must be an existing positive numeric version, not latest."
  }
}

variable "smtp_password_secret_version" {
  description = "Existing numeric Secret Manager version for SMTP_PASSWORD. The secret value remains outside Terraform."
  type        = string

  validation {
    condition     = can(regex("^[1-9][0-9]*$", var.smtp_password_secret_version))
    error_message = "smtp_password_secret_version must be an existing positive numeric version, not latest."
  }
}
