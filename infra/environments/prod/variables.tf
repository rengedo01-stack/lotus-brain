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

variable "deployment_stage" {
  description = "Explicit, monotonic production apply stage. Never lower this value after a successful apply."
  type        = string

  validation {
    condition     = contains(["foundation", "migration", "runtime", "edge"], var.deployment_stage)
    error_message = "deployment_stage must be one of foundation, migration, runtime, or edge."
  }
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
  description = "Initial immutable Web image digest, required only for runtime and edge stages."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.cloud_run_web_image == null || can(regex("^[a-z0-9-]+-docker\\.pkg\\.dev/[^@:/]+/[^@:/]+/web@sha256:[a-f0-9]{64}$", var.cloud_run_web_image))
    error_message = "cloud_run_web_image must be null or an Artifact Registry Web image with an immutable lowercase SHA-256 digest and no tag."
  }

  validation {
    condition     = !contains(["runtime", "edge"], var.deployment_stage) || var.cloud_run_web_image != null
    error_message = "cloud_run_web_image is required for runtime and edge stages."
  }
}

variable "cloud_run_api_image" {
  description = "Initial immutable API-family image digest, required from migration onward."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.cloud_run_api_image == null || can(regex("^[a-z0-9-]+-docker\\.pkg\\.dev/[^@:/]+/[^@:/]+/api@sha256:[a-f0-9]{64}$", var.cloud_run_api_image))
    error_message = "cloud_run_api_image must be null or an Artifact Registry API image with an immutable lowercase SHA-256 digest and no tag."
  }

  validation {
    condition     = var.deployment_stage == "foundation" || var.cloud_run_api_image != null
    error_message = "cloud_run_api_image is required for migration, runtime, and edge stages."
  }
}

variable "production_web_base_url" {
  description = "Approved HTTPS origin for the production Web application, required for runtime and edge stages."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.production_web_base_url == null || can(regex("^https://[^/?#]+/?$", var.production_web_base_url))
    error_message = "production_web_base_url must be null or an HTTPS origin without a path, query, or fragment."
  }

  validation {
    condition     = !contains(["runtime", "edge"], var.deployment_stage) || var.production_web_base_url != null
    error_message = "production_web_base_url is required for runtime and edge stages."
  }
}

variable "monitoring_notification_channel_ids" {
  description = "Operator-owned Cloud Monitoring notification channel resource IDs for production alerts."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for channel_id in var.monitoring_notification_channel_ids : can(regex("^projects/[^/]+/notificationChannels/[0-9]+$", channel_id))
    ])
    error_message = "monitoring_notification_channel_ids entries must be projects/<project>/notificationChannels/<numeric-id> resource IDs."
  }

  validation {
    condition     = !contains(["runtime", "edge"], var.deployment_stage) || length(var.monitoring_notification_channel_ids) > 0
    error_message = "monitoring_notification_channel_ids must be non-empty for runtime and edge stages."
  }
}

variable "enable_external_uptime_monitoring" {
  description = "Creates public Web and API uptime checks only after DNS cutover, certificate activation, and smoke checks are complete."
  type        = bool
  default     = false

  validation {
    condition     = !var.enable_external_uptime_monitoring || var.deployment_stage == "edge"
    error_message = "enable_external_uptime_monitoring may be true only for the edge stage."
  }
}

variable "webauthn_rp_name" {
  description = "Approved WebAuthn relying-party display name, required for runtime and edge stages."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.webauthn_rp_name == null || length(trimspace(var.webauthn_rp_name)) > 0
    error_message = "webauthn_rp_name must be null or non-empty."
  }

  validation {
    condition     = !contains(["runtime", "edge"], var.deployment_stage) || var.webauthn_rp_name != null
    error_message = "webauthn_rp_name is required for runtime and edge stages."
  }
}

variable "webauthn_rp_id" {
  description = "Approved WebAuthn relying-party ID, required for runtime and edge stages."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.webauthn_rp_id == null || can(regex("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$", var.webauthn_rp_id))
    error_message = "webauthn_rp_id must be null or a lowercase registrable domain suffix."
  }

  validation {
    condition     = !contains(["runtime", "edge"], var.deployment_stage) || var.webauthn_rp_id != null
    error_message = "webauthn_rp_id is required for runtime and edge stages."
  }
}

variable "smtp_host" {
  description = "Owner-approved SMTP hostname, required for runtime and edge stages."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.smtp_host == null || length(trimspace(var.smtp_host)) > 0
    error_message = "smtp_host must be null or non-empty."
  }

  validation {
    condition     = !contains(["runtime", "edge"], var.deployment_stage) || var.smtp_host != null
    error_message = "smtp_host is required for runtime and edge stages."
  }
}

variable "smtp_port" {
  description = "Owner-approved SMTP TCP port, required for runtime and edge stages."
  type        = number
  default     = null
  nullable    = true

  validation {
    condition     = var.smtp_port == null || (var.smtp_port >= 1 && var.smtp_port <= 65535 && floor(var.smtp_port) == var.smtp_port)
    error_message = "smtp_port must be null or an integer between 1 and 65535."
  }

  validation {
    condition     = !contains(["runtime", "edge"], var.deployment_stage) || var.smtp_port != null
    error_message = "smtp_port is required for runtime and edge stages."
  }
}

variable "smtp_secure" {
  description = "Whether the SMTP provider requires implicit TLS, required for runtime and edge stages."
  type        = bool
  default     = null
  nullable    = true

  validation {
    condition     = !contains(["runtime", "edge"], var.deployment_stage) || var.smtp_secure != null
    error_message = "smtp_secure is required for runtime and edge stages."
  }
}

variable "smtp_from" {
  description = "Owner-approved sender address, required for runtime and edge stages."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.smtp_from == null || length(trimspace(var.smtp_from)) > 0
    error_message = "smtp_from must be null or non-empty."
  }

  validation {
    condition     = !contains(["runtime", "edge"], var.deployment_stage) || var.smtp_from != null
    error_message = "smtp_from is required for runtime and edge stages."
  }
}

variable "database_url_secret_version" {
  description = "Existing numeric Secret Manager version for DATABASE_URL. The secret value remains outside Terraform."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.database_url_secret_version == null || can(regex("^[1-9][0-9]*$", var.database_url_secret_version))
    error_message = "database_url_secret_version must be null or an existing positive numeric version, not latest."
  }

  validation {
    condition     = var.deployment_stage == "foundation" || var.database_url_secret_version != null
    error_message = "database_url_secret_version is required from the migration stage onward."
  }
}

variable "smtp_user_secret_version" {
  description = "Existing numeric Secret Manager version for SMTP_USER. The secret value remains outside Terraform."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.smtp_user_secret_version == null || can(regex("^[1-9][0-9]*$", var.smtp_user_secret_version))
    error_message = "smtp_user_secret_version must be null or an existing positive numeric version, not latest."
  }

  validation {
    condition     = !contains(["runtime", "edge"], var.deployment_stage) || var.smtp_user_secret_version != null
    error_message = "smtp_user_secret_version is required for runtime and edge stages."
  }
}

variable "smtp_password_secret_version" {
  description = "Existing numeric Secret Manager version for SMTP_PASSWORD. The secret value remains outside Terraform."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.smtp_password_secret_version == null || can(regex("^[1-9][0-9]*$", var.smtp_password_secret_version))
    error_message = "smtp_password_secret_version must be null or an existing positive numeric version, not latest."
  }

  validation {
    condition     = !contains(["runtime", "edge"], var.deployment_stage) || var.smtp_password_secret_version != null
    error_message = "smtp_password_secret_version is required for runtime and edge stages."
  }
}
