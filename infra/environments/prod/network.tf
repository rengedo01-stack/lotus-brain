module "network" {
  source = "../../modules/network"

  project_id                   = var.project_id
  region                       = var.region
  network_name                 = "${var.system_name}-prod-vpc"
  app_subnet_cidr              = var.app_subnet_cidr
  worker_subnet_cidr           = var.worker_subnet_cidr
  private_services_access_cidr = var.private_services_access_cidr

  depends_on = [
    google_project_service.required["compute.googleapis.com"],
    google_project_service.required["servicenetworking.googleapis.com"],
  ]
}
