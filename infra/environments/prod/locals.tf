locals {
  labels = {
    system      = var.system_name
    environment = var.environment
    managed-by  = "terraform"
    component   = "foundation"
  }

  required_services = toset([
    "artifactregistry.googleapis.com",
    "certificatemanager.googleapis.com",
    "compute.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "sqladmin.googleapis.com",
    "storage.googleapis.com",
    "sts.googleapis.com",
  ])

  runtime_service_accounts = {
    web = {
      account_id   = "lotus-brain-web"
      display_name = "Lotus BRAIN web runtime"
    }
    api = {
      account_id   = "lotus-brain-api"
      display_name = "Lotus BRAIN API runtime"
    }
    worker = {
      account_id   = "lotus-brain-worker"
      display_name = "Lotus BRAIN notification worker"
    }
    migration = {
      account_id   = "lotus-brain-migration"
      display_name = "Lotus BRAIN database migration"
    }
    backup = {
      account_id   = "lotus-brain-backup"
      display_name = "Lotus BRAIN database backup"
    }
  }

  application_secrets = {
    database_url  = "${var.system_name}-${var.environment}-database-url"
    smtp_user     = "${var.system_name}-${var.environment}-smtp-user"
    smtp_password = "${var.system_name}-${var.environment}-smtp-password"
  }

  secret_accessors = {
    database_url  = toset(["api", "worker", "migration", "backup"])
    smtp_user     = toset(["api", "worker"])
    smtp_password = toset(["api", "worker"])
  }

  secret_accessor_members = {
    for pair in flatten([
      for secret_key, service_accounts in local.secret_accessors : [
        for service_account_key in service_accounts : {
          secret_key          = secret_key
          service_account_key = service_account_key
        }
      ]
    ]) : "${pair.secret_key}-${pair.service_account_key}" => pair
  }
}
