resource "google_certificate_manager_dns_authorization" "production" {
  project  = var.project_id
  location = "global"
  name     = "${var.system_name}-${var.environment}-dns-auth"
  domain   = local.production_hostname
  type     = "PER_PROJECT_RECORD"

  depends_on = [google_project_service.required["certificatemanager.googleapis.com"]]
}

resource "google_certificate_manager_certificate" "production" {
  project  = var.project_id
  location = "global"
  name     = "${var.system_name}-${var.environment}-certificate"

  managed {
    domains = [local.production_hostname]
    dns_authorizations = [
      google_certificate_manager_dns_authorization.production.id,
    ]
  }
}

resource "google_certificate_manager_certificate_map" "production" {
  project = var.project_id
  name    = "${var.system_name}-${var.environment}-certificate-map"
}

resource "google_certificate_manager_certificate_map_entry" "production" {
  project = var.project_id
  name    = "${var.system_name}-${var.environment}-certificate-entry"
  map     = google_certificate_manager_certificate_map.production.name

  certificates = [google_certificate_manager_certificate.production.id]
  hostname     = local.production_hostname
}
