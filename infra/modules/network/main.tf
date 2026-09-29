resource "google_compute_network" "production" {
  project                 = var.project_id
  name                    = var.network_name
  auto_create_subnetworks = false
  description             = "Lotus BRAIN production custom-mode network."

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_compute_subnetwork" "app" {
  project                  = var.project_id
  name                     = "${var.network_name}-app"
  region                   = var.region
  network                  = google_compute_network.production.id
  ip_cidr_range            = var.app_subnet_cidr
  private_ip_google_access = true
  description              = "Reserved application subnet with Private Google Access."
}

resource "google_compute_subnetwork" "worker" {
  project                  = var.project_id
  name                     = "${var.network_name}-worker"
  region                   = var.region
  network                  = google_compute_network.production.id
  ip_cidr_range            = var.worker_subnet_cidr
  private_ip_google_access = true
  description              = "Reserved worker subnet with Private Google Access."
}

resource "google_compute_global_address" "private_services_access" {
  project       = var.project_id
  name          = "${var.network_name}-psa"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  network       = google_compute_network.production.id
  address       = split("/", var.private_services_access_cidr)[0]
  prefix_length = tonumber(split("/", var.private_services_access_cidr)[1])
  description   = "Reserved Private Services Access range for managed services."

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_service_networking_connection" "private_services_access" {
  network                 = google_compute_network.production.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services_access.name]
}
