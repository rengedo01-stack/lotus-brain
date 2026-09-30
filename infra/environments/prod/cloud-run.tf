locals {
  release_service_account_member = "serviceAccount:lotus-brain-release@${var.project_id}.iam.gserviceaccount.com"
  production_web_origin          = trimsuffix(var.production_web_base_url, "/")

  api_runtime_environment = {
    CORS_ORIGIN         = local.production_web_origin
    PUBLIC_WEB_BASE_URL = var.production_web_base_url
    SMTP_FROM           = var.smtp_from
    SMTP_HOST           = var.smtp_host
    SMTP_PORT           = tostring(var.smtp_port)
    SMTP_SECURE         = tostring(var.smtp_secure)
    WEBAUTHN_ORIGIN     = local.production_web_origin
    WEBAUTHN_RP_ID      = var.webauthn_rp_id
    WEBAUTHN_RP_NAME    = var.webauthn_rp_name
  }
}

resource "google_cloud_run_v2_service" "web" {
  project              = var.project_id
  name                 = "${var.system_name}-${var.environment}-web"
  location             = var.region
  ingress              = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  invoker_iam_disabled = true
  deletion_protection  = true

  template {
    service_account                  = google_service_account.runtime["web"].email
    timeout                          = "60s"
    max_instance_request_concurrency = 80

    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    containers {
      image = var.cloud_run_web_image

      ports {
        container_port = 8080
      }

      resources {
        cpu_idle = true
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
  }

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [template[0].containers[0].image]
  }

  depends_on = [google_project_service.required["run.googleapis.com"]]
}

resource "google_cloud_run_v2_service" "api" {
  project              = var.project_id
  name                 = "${var.system_name}-${var.environment}-api"
  location             = var.region
  ingress              = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  invoker_iam_disabled = true
  deletion_protection  = true

  template {
    service_account                  = google_service_account.runtime["api"].email
    timeout                          = "60s"
    max_instance_request_concurrency = 40

    scaling {
      min_instance_count = 1
      max_instance_count = 2
    }

    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"

      network_interfaces {
        network    = module.network.network_id
        subnetwork = module.network.app_subnet_id
      }
    }

    containers {
      image = var.cloud_run_api_image

      ports {
        container_port = 8080
      }

      dynamic "env" {
        for_each = local.api_runtime_environment

        content {
          name  = env.key
          value = env.value
        }
      }

      env {
        name = "DATABASE_URL"

        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.application["database_url"].id
            version = var.database_url_secret_version
          }
        }
      }

      env {
        name = "SMTP_USER"

        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.application["smtp_user"].id
            version = var.smtp_user_secret_version
          }
        }
      }

      env {
        name = "SMTP_PASSWORD"

        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.application["smtp_password"].id
            version = var.smtp_password_secret_version
          }
        }
      }

      resources {
        cpu_idle = true
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
  }

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [template[0].containers[0].image]
  }

  depends_on = [
    google_project_service.required["run.googleapis.com"],
    google_secret_manager_secret_iam_member.runtime_accessor,
    google_compute_subnetwork_iam_member.cloud_run_direct_vpc,
    module.network,
  ]
}

resource "google_cloud_run_v2_job" "migration" {
  project             = var.project_id
  name                = "${var.system_name}-${var.environment}-migrate"
  location            = var.region
  deletion_protection = true

  template {
    task_count  = 1
    parallelism = 1

    template {
      service_account = google_service_account.runtime["migration"].email
      max_retries     = 0
      timeout         = "900s"

      vpc_access {
        egress = "PRIVATE_RANGES_ONLY"

        network_interfaces {
          network    = module.network.network_id
          subnetwork = module.network.app_subnet_id
        }
      }

      containers {
        image   = var.cloud_run_api_image
        command = ["pnpm"]
        args    = ["exec", "prisma", "migrate", "deploy", "--config", "./prisma.config.ts"]

        env {
          name = "DATABASE_URL"

          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.application["database_url"].id
              version = var.database_url_secret_version
            }
          }
        }

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }
      }
    }
  }

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [template[0].template[0].containers[0].image]
  }

  depends_on = [
    google_project_service.required["run.googleapis.com"],
    google_secret_manager_secret_iam_member.runtime_accessor,
    google_compute_subnetwork_iam_member.cloud_run_direct_vpc,
    module.network,
  ]
}

resource "google_cloud_run_v2_worker_pool" "notification" {
  project             = var.project_id
  name                = "${var.system_name}-${var.environment}-notification-worker"
  location            = var.region
  deletion_protection = true

  template {
    service_account = google_service_account.runtime["worker"].email

    vpc_access {
      egress = "ALL_TRAFFIC"

      network_interfaces {
        network    = module.network.network_id
        subnetwork = module.network.worker_subnet_id
      }
    }

    containers {
      image   = var.cloud_run_api_image
      command = ["node"]
      args    = ["dist/notification.worker.js"]

      dynamic "env" {
        for_each = local.api_runtime_environment

        content {
          name  = env.key
          value = env.value
        }
      }

      env {
        name = "DATABASE_URL"

        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.application["database_url"].id
            version = var.database_url_secret_version
          }
        }
      }

      env {
        name = "SMTP_USER"

        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.application["smtp_user"].id
            version = var.smtp_user_secret_version
          }
        }
      }

      env {
        name = "SMTP_PASSWORD"

        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.application["smtp_password"].id
            version = var.smtp_password_secret_version
          }
        }
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
  }

  scaling {
    scaling_mode          = "MANUAL"
    manual_instance_count = 1
  }

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [template[0].containers[0].image]
  }

  depends_on = [
    google_project_service.required["run.googleapis.com"],
    google_secret_manager_secret_iam_member.runtime_accessor,
    google_compute_subnetwork_iam_member.cloud_run_worker_direct_vpc,
    google_compute_router_nat.worker_egress,
    module.network,
  ]
}
