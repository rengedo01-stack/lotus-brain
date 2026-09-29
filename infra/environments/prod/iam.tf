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
