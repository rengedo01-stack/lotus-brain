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

output "cloud_run_notification_worker_pool_name" {
  description = "Production notification Cloud Run Worker Pool name."
  value       = google_cloud_run_v2_worker_pool.notification.name
}

output "worker_nat_external_ip" {
  description = "Static external IP used only for notification worker egress through Cloud NAT."
  value       = google_compute_address.worker_nat.address
}

output "load_balancer_ipv4" {
  description = "Global IPv4 address for the production external Application Load Balancer and external DNS A record."
  value       = google_compute_global_address.production.address
}

output "certificate_dns_authorization_cname_name" {
  description = "External-DNS CNAME owner name required for Certificate Manager authorization."
  value       = google_certificate_manager_dns_authorization.production.dns_resource_record[0].name
}

output "certificate_dns_authorization_cname_type" {
  description = "External-DNS record type required for Certificate Manager authorization."
  value       = google_certificate_manager_dns_authorization.production.dns_resource_record[0].type
}

output "certificate_dns_authorization_cname_target" {
  description = "External-DNS CNAME target required for Certificate Manager authorization."
  value       = google_certificate_manager_dns_authorization.production.dns_resource_record[0].data
}

output "production_certificate_id" {
  description = "Certificate Manager certificate identifier; verify ACTIVE status outside Terraform before DNS cutover."
  value       = google_certificate_manager_certificate.production.id
}

output "production_certificate_map_id" {
  description = "Certificate Manager certificate map identifier attached to the HTTPS proxy."
  value       = google_certificate_manager_certificate_map.production.id
}

output "production_https_proxy_name" {
  description = "Target HTTPS proxy name for the production external Application Load Balancer."
  value       = google_compute_target_https_proxy.production.name
}

output "edge_security_policy_id" {
  description = "Cloud Armor policy ID attached to both production external Application Load Balancer backends."
  value       = google_compute_security_policy.edge.id
}

output "production_alert_policy_names" {
  description = "Names of Terraform-managed production alert policies; notification channel IDs are never output."
  value = {
    worker_availability         = google_monitoring_alert_policy.worker_availability.display_name
    cloud_sql_disk              = google_monitoring_alert_policy.metric["cloud_sql_disk"].display_name
    cloud_sql_memory            = google_monitoring_alert_policy.metric["cloud_sql_memory"].display_name
    cloud_sql_oom               = google_monitoring_alert_policy.log["cloud_sql_oom"].display_name
    cloud_sql_backup_failure    = google_monitoring_alert_policy.log["cloud_sql_backup_failure"].display_name
    cloud_nat_allocation        = google_monitoring_alert_policy.metric["cloud_nat_allocation"].display_name
    cloud_nat_packet_drop       = google_monitoring_alert_policy.metric["cloud_nat_packet_drop"].display_name
    certificate_expired         = google_monitoring_alert_policy.log["certificate_expired"].display_name
    certificate_close_to_expiry = google_monitoring_alert_policy.log["certificate_close_to_expiry"].display_name
  }
}

output "external_uptime_check_names" {
  description = "Names of cutover-gated external uptime checks; empty until enable_external_uptime_monitoring is true."
  value = var.enable_external_uptime_monitoring ? {
    web = google_monitoring_uptime_check_config.web[0].display_name
    api = google_monitoring_uptime_check_config.api[0].display_name
  } : {}
}
