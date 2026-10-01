locals {
  production_hostname = local.production_web_origin == null ? null : trimprefix(local.production_web_origin, "https://")
}

resource "google_compute_global_address" "production" {
  count = local.edge_enabled ? 1 : 0

  project      = var.project_id
  name         = "${var.system_name}-${var.environment}-lb-ip"
  address_type = "EXTERNAL"
  ip_version   = "IPV4"

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.required["compute.googleapis.com"]]
}

resource "google_compute_region_network_endpoint_group" "web" {
  count = local.edge_enabled ? 1 : 0

  project               = var.project_id
  region                = var.region
  name                  = "${var.system_name}-${var.environment}-web-neg"
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.web[0].name
  }
}

resource "google_compute_region_network_endpoint_group" "api" {
  count = local.edge_enabled ? 1 : 0

  project               = var.project_id
  region                = var.region
  name                  = "${var.system_name}-${var.environment}-api-neg"
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.api[0].name
  }
}

resource "google_compute_backend_service" "web" {
  count = local.edge_enabled ? 1 : 0

  project               = var.project_id
  name                  = "${var.system_name}-${var.environment}-web-backend"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTP"
  security_policy       = google_compute_security_policy.edge[0].id

  backend {
    group = google_compute_region_network_endpoint_group.web[0].id
  }

  log_config {
    enable      = true
    sample_rate = 1.0
  }
}

resource "google_compute_backend_service" "api" {
  count = local.edge_enabled ? 1 : 0

  project               = var.project_id
  name                  = "${var.system_name}-${var.environment}-api-backend"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTP"
  security_policy       = google_compute_security_policy.edge[0].id

  backend {
    group = google_compute_region_network_endpoint_group.api[0].id
  }

  log_config {
    enable      = true
    sample_rate = 1.0
  }
}

resource "google_compute_url_map" "production" {
  count = local.edge_enabled ? 1 : 0

  project         = var.project_id
  name            = "${var.system_name}-${var.environment}-https"
  default_service = google_compute_backend_service.web[0].id

  host_rule {
    hosts        = [local.production_hostname]
    path_matcher = "production"
  }

  path_matcher {
    name            = "production"
    default_service = google_compute_backend_service.web[0].id

    path_rule {
      paths   = ["/api/v1", "/api/v1/*"]
      service = google_compute_backend_service.api[0].id
    }
  }
}

resource "google_compute_target_https_proxy" "production" {
  count = local.edge_enabled ? 1 : 0

  project = var.project_id
  name    = "${var.system_name}-${var.environment}-https"
  url_map = google_compute_url_map.production[0].id

  certificate_map = "//certificatemanager.googleapis.com/${google_certificate_manager_certificate_map.production[0].id}"
}

resource "google_compute_global_forwarding_rule" "https" {
  count = local.edge_enabled ? 1 : 0

  project               = var.project_id
  name                  = "${var.system_name}-${var.environment}-https"
  ip_address            = google_compute_global_address.production[0].id
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  network_tier          = "PREMIUM"
  port_range            = "443"
  target                = google_compute_target_https_proxy.production[0].id
}

resource "google_compute_url_map" "http_redirect" {
  count = local.edge_enabled ? 1 : 0

  project = var.project_id
  name    = "${var.system_name}-${var.environment}-http-redirect"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "http_redirect" {
  count = local.edge_enabled ? 1 : 0

  project = var.project_id
  name    = "${var.system_name}-${var.environment}-http-redirect"
  url_map = google_compute_url_map.http_redirect[0].id
}

resource "google_compute_global_forwarding_rule" "http_redirect" {
  count = local.edge_enabled ? 1 : 0

  project               = var.project_id
  name                  = "${var.system_name}-${var.environment}-http-redirect"
  ip_address            = google_compute_global_address.production[0].id
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  network_tier          = "PREMIUM"
  port_range            = "80"
  target                = google_compute_target_http_proxy.http_redirect[0].id
}
