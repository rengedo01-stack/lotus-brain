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
