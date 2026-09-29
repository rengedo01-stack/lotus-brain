output "network_id" {
  value = google_compute_network.production.id
}

output "network_name" {
  value = google_compute_network.production.name
}

output "app_subnet_id" {
  value = google_compute_subnetwork.app.id
}

output "worker_subnet_id" {
  value = google_compute_subnetwork.worker.id
}

output "private_services_access_range" {
  value = google_compute_global_address.private_services_access.address
}

output "private_services_access_range_name" {
  value = google_compute_global_address.private_services_access.name
}
