resource "google_service_account" "runtime" {
  for_each = local.runtime_service_accounts

  project      = var.project_id
  account_id   = each.value.account_id
  display_name = each.value.display_name
  description  = "Dedicated least-privilege identity; roles are added with its concrete runtime resource."

  depends_on = [google_project_service.required["iam.googleapis.com"]]
}

resource "google_artifact_registry_repository_iam_member" "release_writer" {
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.containers.repository_id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:lotus-brain-release@${var.project_id}.iam.gserviceaccount.com"
}

data "google_project" "production" {
  project_id = var.project_id
}

resource "google_compute_subnetwork_iam_member" "cloud_run_direct_vpc" {
  count = local.migration_enabled ? 1 : 0

  project    = var.project_id
  region     = var.region
  subnetwork = module.network.app_subnet_id
  role       = "roles/compute.networkUser"
  member     = "service-${data.google_project.production.number}@serverless-robot-prod.iam.gserviceaccount.com"
}

resource "google_compute_subnetwork_iam_member" "cloud_run_worker_direct_vpc" {
  count = local.runtime_enabled ? 1 : 0

  project    = var.project_id
  region     = var.region
  subnetwork = module.network.worker_subnet_id
  role       = "roles/compute.networkUser"
  member     = "service-${data.google_project.production.number}@serverless-robot-prod.iam.gserviceaccount.com"
}

resource "google_cloud_run_v2_service_iam_member" "release_developer" {
  for_each = local.runtime_enabled ? {
    web = google_cloud_run_v2_service.web[0]
    api = google_cloud_run_v2_service.api[0]
  } : {}

  project  = each.value.project
  location = each.value.location
  name     = each.value.name
  role     = "roles/run.developer"
  member   = local.release_service_account_member
}

resource "google_cloud_run_v2_job_iam_member" "release_developer" {
  count = local.migration_enabled ? 1 : 0

  project  = google_cloud_run_v2_job.migration[0].project
  location = google_cloud_run_v2_job.migration[0].location
  name     = google_cloud_run_v2_job.migration[0].name
  role     = "roles/run.developer"
  member   = local.release_service_account_member
}

resource "google_cloud_run_v2_worker_pool_iam_member" "release_developer" {
  count = local.runtime_enabled ? 1 : 0

  project  = google_cloud_run_v2_worker_pool.notification[0].project
  location = google_cloud_run_v2_worker_pool.notification[0].location
  name     = google_cloud_run_v2_worker_pool.notification[0].name
  role     = "roles/run.developer"
  member   = local.release_service_account_member
}

resource "google_cloud_run_v2_job_iam_member" "release_executor" {
  count = local.migration_enabled ? 1 : 0

  project  = google_cloud_run_v2_job.migration[0].project
  location = google_cloud_run_v2_job.migration[0].location
  name     = google_cloud_run_v2_job.migration[0].name
  role     = "roles/run.jobsExecutor"
  member   = local.release_service_account_member
}

resource "google_service_account_iam_member" "release_runtime_user" {
  for_each = local.runtime_enabled ? toset(["web", "api", "worker", "migration"]) : (local.migration_enabled ? toset(["migration"]) : toset([]))

  service_account_id = google_service_account.runtime[each.value].name
  role               = "roles/iam.serviceAccountUser"
  member             = local.release_service_account_member
}
