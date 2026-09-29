module "cloud_sql" {
  source = "../../modules/cloud-sql"

  project_id                         = var.project_id
  region                             = var.region
  instance_name                      = "${var.system_name}-${var.environment}-postgres"
  private_network                    = module.network.network_id
  private_services_access_range_name = module.network.private_services_access_range_name
  backup_location                    = var.cloud_sql_backup_location
  maintenance_day                    = var.cloud_sql_maintenance_day
  maintenance_hour                   = var.cloud_sql_maintenance_hour

  # Ensures the PSA service-networking connection is complete before Cloud SQL uses it.
  depends_on = [module.network]
}
