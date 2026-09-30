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
  project    = var.project_id
  region     = var.region
  subnetwork = module.network.app_subnet_id
  role       = "roles/compute.networkUser"
  member     = "service-${data.google_project.production.number}@serverless-robot-prod.iam.gserviceaccount.com"
}

resource "google_cloud_run_v2_service_iam_member" "release_developer" {
  for_each = {
    web = google_cloud_run_v2_service.web
    api = google_cloud_run_v2_service.api
  }

  project  = each.value.project
  location = each.value.location
  name     = each.value.name
  role     = "roles/run.developer"
  member   = local.release_service_account_member
}

resource "google_cloud_run_v2_job_iam_member" "release_developer" {
  project  = google_cloud_run_v2_job.migration.project
  location = google_cloud_run_v2_job.migration.location
  name     = google_cloud_run_v2_job.migration.name
  role     = "roles/run.developer"
  member   = local.release_service_account_member
}

resource "google_cloud_run_v2_job_iam_member" "release_executor" {
  project  = google_cloud_run_v2_job.migration.project
  location = google_cloud_run_v2_job.migration.location
  name     = google_cloud_run_v2_job.migration.name
  role     = "roles/run.jobsExecutor"
  member   = local.release_service_account_member
}

resource "google_service_account_iam_member" "release_runtime_user" {
  for_each = toset(["web", "api", "migration"])

  service_account_id = google_service_account.runtime[each.value].name
  role               = "roles/iam.serviceAccountUser"
  member             = local.release_service_account_member
}
