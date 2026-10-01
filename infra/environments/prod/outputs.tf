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
  value       = try(google_cloud_run_v2_service.web[0].name, null)
}

output "cloud_run_api_service_name" {
  description = "Production API Cloud Run service name."
  value       = try(google_cloud_run_v2_service.api[0].name, null)
}

output "cloud_run_migration_job_name" {
  description = "Production migration Cloud Run Job name."
  value       = try(google_cloud_run_v2_job.migration[0].name, null)
}

output "cloud_run_notification_worker_pool_name" {
  description = "Production notification Cloud Run Worker Pool name."
  value       = try(google_cloud_run_v2_worker_pool.notification[0].name, null)
}

output "worker_nat_external_ip" {
  description = "Static external IP used only for notification worker egress through Cloud NAT."
  value       = try(google_compute_address.worker_nat[0].address, null)
}

output "load_balancer_ipv4" {
  description = "Global IPv4 address for the production external Application Load Balancer and external DNS A record."
  value       = try(google_compute_global_address.production[0].address, null)
}

output "certificate_dns_authorization_cname_name" {
  description = "External-DNS CNAME owner name required for Certificate Manager authorization."
  value       = try(google_certificate_manager_dns_authorization.production[0].dns_resource_record[0].name, null)
}

output "certificate_dns_authorization_cname_type" {
  description = "External-DNS record type required for Certificate Manager authorization."
  value       = try(google_certificate_manager_dns_authorization.production[0].dns_resource_record[0].type, null)
}

output "certificate_dns_authorization_cname_target" {
  description = "External-DNS CNAME target required for Certificate Manager authorization."
  value       = try(google_certificate_manager_dns_authorization.production[0].dns_resource_record[0].data, null)
}

output "production_certificate_id" {
  description = "Certificate Manager certificate identifier; verify ACTIVE status outside Terraform before DNS cutover."
  value       = try(google_certificate_manager_certificate.production[0].id, null)
}

output "production_certificate_map_id" {
  description = "Certificate Manager certificate map identifier attached to the HTTPS proxy."
  value       = try(google_certificate_manager_certificate_map.production[0].id, null)
}

output "production_https_proxy_name" {
  description = "Target HTTPS proxy name for the production external Application Load Balancer."
  value       = try(google_compute_target_https_proxy.production[0].name, null)
}

output "edge_security_policy_id" {
  description = "Cloud Armor policy ID attached to both production external Application Load Balancer backends."
  value       = try(google_compute_security_policy.edge[0].id, null)
}

output "production_alert_policy_names" {
  description = "Names of Terraform-managed production alert policies; notification channel IDs are never output."
  value = merge(
    local.runtime_enabled ? { worker_availability = google_monitoring_alert_policy.worker_availability[0].display_name } : {},
    { for key, policy in merge(google_monitoring_alert_policy.metric, google_monitoring_alert_policy.log) : key => policy.display_name },
  )
}

output "external_uptime_check_names" {
  description = "Names of cutover-gated external uptime checks; empty until enable_external_uptime_monitoring is true."
  value = local.edge_enabled && var.enable_external_uptime_monitoring ? {
    web = google_monitoring_uptime_check_config.web[0].display_name
    api = google_monitoring_uptime_check_config.api[0].display_name
  } : {}
}

output "deployment_stage" {
  description = "Explicit non-secret production apply stage. Operators must advance it monotonically."
  value       = var.deployment_stage
}
