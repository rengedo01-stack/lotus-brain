output "vpc_id" {
  description = "Production VPC resource ID."
  value       = module.network.network_id
}

output "vpc_name" {
  description = "Production VPC name."
  value       = module.network.network_name
}

output "app_subnet_id" {
  description = "Application subnet resource ID."
  value       = module.network.app_subnet_id
}

output "worker_subnet_id" {
  description = "Worker subnet resource ID."
  value       = module.network.worker_subnet_id
}

output "private_services_access_range" {
  description = "Reserved Private Services Access IP range."
  value       = module.network.private_services_access_range
}

output "artifact_registry_repository" {
  description = "Docker Artifact Registry repository name."
  value       = google_artifact_registry_repository.containers.name
}

output "secret_resource_ids" {
  description = "Secret Manager resource IDs only; no secret values are output."
  value       = { for key, secret in google_secret_manager_secret.application : key => secret.id }
}
