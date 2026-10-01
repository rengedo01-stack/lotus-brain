resource "google_compute_address" "worker_nat" {
  count = local.runtime_enabled ? 1 : 0

  project      = var.project_id
  name         = "${var.system_name}-${var.environment}-worker-nat"
  region       = var.region
  address_type = "EXTERNAL"
  network_tier = "PREMIUM"

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_compute_router" "worker_egress" {
  count = local.runtime_enabled ? 1 : 0

  project = var.project_id
  name    = "${var.system_name}-${var.environment}-worker-router"
  region  = var.region
  network = module.network.network_id

  bgp {
    asn = 64514
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.required["compute.googleapis.com"]]
}

resource "google_compute_router_nat" "worker_egress" {
  count = local.runtime_enabled ? 1 : 0

  project = var.project_id
  name    = "${var.system_name}-${var.environment}-worker-nat"
  router  = google_compute_router.worker_egress[0].name
  region  = var.region

  type                               = "PUBLIC"
  nat_ip_allocate_option             = "MANUAL_ONLY"
  nat_ips                            = [google_compute_address.worker_nat[0].self_link]
  endpoint_types                     = ["ENDPOINT_TYPE_VM"]
  min_ports_per_vm                   = 64
  source_subnetwork_ip_ranges_to_nat = "LIST_OF_SUBNETWORKS"

  subnetwork {
    name                    = module.network.worker_subnet_id
    source_ip_ranges_to_nat = ["ALL_IP_RANGES"]
  }

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [
    google_project_service.required["compute.googleapis.com"],
    module.network,
  ]
}
