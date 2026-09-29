resource "google_sql_database_instance" "production" {
  project          = var.project_id
  name             = var.instance_name
  region           = var.region
  database_version = "POSTGRES_17"

  # Requires an explicit reviewed change before Terraform can delete the instance.
  deletion_protection = true

  settings {
    edition           = "ENTERPRISE"
    tier              = "db-custom-2-7680"
    availability_type = "REGIONAL"

    disk_type             = "PD_SSD"
    disk_size             = 20
    disk_autoresize       = true
    disk_autoresize_limit = 100

    # Cloud SQL independently protects the instance from deletion through its API.
    deletion_protection_enabled = true
    retain_backups_on_delete    = true

    backup_configuration {
      enabled                        = true
      start_time                     = "18:00"
      location                       = var.backup_location
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7

      backup_retention_settings {
        retained_backups = 14
        retention_unit   = "COUNT"
      }
    }

    final_backup_config {
      enabled        = true
      retention_days = 14
    }

    maintenance_window {
      day          = var.maintenance_day
      hour         = var.maintenance_hour
      update_track = "stable"
    }

    ip_configuration {
      ipv4_enabled       = false
      private_network    = var.private_network
      allocated_ip_range = var.private_services_access_range_name
      ssl_mode           = "ENCRYPTED_ONLY"
    }
  }

  lifecycle {
    prevent_destroy = true

    # Cloud SQL can only grow disks. Do not attempt to shrink an auto-resized disk.
    ignore_changes = [settings[0].disk_size]
  }
}

resource "google_sql_database" "application" {
  project         = var.project_id
  name            = "lotus_brain"
  instance        = google_sql_database_instance.production.name
  deletion_policy = "ABANDON"
}
