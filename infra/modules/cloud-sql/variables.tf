variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "instance_name" {
  type = string
}

variable "private_network" {
  type = string
}

variable "private_services_access_range_name" {
  type = string
}

variable "backup_location" {
  description = "Owner-approved Cloud SQL backup location, set explicitly for production."
  type        = string

  validation {
    condition     = length(trimspace(var.backup_location)) > 0
    error_message = "backup_location must be an explicit, non-empty Cloud SQL backup location."
  }
}

variable "maintenance_day" {
  description = "Cloud SQL weekly maintenance day in UTC (1 is Monday and 7 is Sunday)."
  type        = number

  validation {
    condition     = var.maintenance_day >= 1 && var.maintenance_day <= 7
    error_message = "maintenance_day must be between 1 (Monday) and 7 (Sunday)."
  }
}

variable "maintenance_hour" {
  description = "Cloud SQL maintenance hour in UTC."
  type        = number

  validation {
    condition     = var.maintenance_hour >= 0 && var.maintenance_hour <= 23
    error_message = "maintenance_hour must be between 0 and 23 UTC."
  }
}
