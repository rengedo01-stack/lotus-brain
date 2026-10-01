resource "google_certificate_manager_dns_authorization" "production" {
  count = local.edge_enabled ? 1 : 0

  project  = var.project_id
  location = "global"
  name     = "${var.system_name}-${var.environment}-dns-auth"
  domain   = local.production_hostname
  type     = "PER_PROJECT_RECORD"

  depends_on = [google_project_service.required["certificatemanager.googleapis.com"]]
}

resource "google_certificate_manager_certificate" "production" {
  count = local.edge_enabled ? 1 : 0

  project  = var.project_id
  location = "global"
  name     = "${var.system_name}-${var.environment}-certificate"

  managed {
    domains = [local.production_hostname]
    dns_authorizations = [
      google_certificate_manager_dns_authorization.production[0].id,
    ]
  }
}

resource "google_certificate_manager_certificate_map" "production" {
  count = local.edge_enabled ? 1 : 0

  project = var.project_id
  name    = "${var.system_name}-${var.environment}-certificate-map"
}

resource "google_certificate_manager_certificate_map_entry" "production" {
  count = local.edge_enabled ? 1 : 0

  project = var.project_id
  name    = "${var.system_name}-${var.environment}-certificate-entry"
  map     = google_certificate_manager_certificate_map.production[0].name

  certificates = [google_certificate_manager_certificate.production[0].id]
  hostname     = local.production_hostname
}
