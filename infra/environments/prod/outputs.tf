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

output "cloud_sql_instance_name" {
  description = "Cloud SQL instance name."
  value       = module.cloud_sql.instance_name
}

output "cloud_sql_connection_name" {
  description = "Cloud SQL connection name."
  value       = module.cloud_sql.connection_name
}

output "cloud_sql_private_ip_address" {
  description = "Cloud SQL private IP address."
  value       = module.cloud_sql.private_ip_address
}

output "cloud_sql_database_name" {
  description = "Cloud SQL application database name."
  value       = module.cloud_sql.database_name
}

output "artifact_registry_repository" {
  description = "Docker Artifact Registry repository name."
  value       = google_artifact_registry_repository.containers.name
}

output "secret_resource_ids" {
  description = "Secret Manager resource IDs only; no secret values are output."
  value       = { for key, secret in google_secret_manager_secret.application : key => secret.id }
}

output "cloud_run_web_service_name" {
  description = "Production Web Cloud Run service name."
  value       = google_cloud_run_v2_service.web.name
}

output "cloud_run_api_service_name" {
  description = "Production API Cloud Run service name."
  value       = google_cloud_run_v2_service.api.name
}

output "cloud_run_migration_job_name" {
  description = "Production migration Cloud Run Job name."
  value       = google_cloud_run_v2_job.migration.name
}
