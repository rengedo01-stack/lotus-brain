resource "google_secret_manager_secret" "application" {
  for_each = local.application_secrets

  project   = var.project_id
  secret_id = each.value

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.required["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_iam_member" "runtime_accessor" {
  for_each = local.secret_accessor_members

  project   = var.project_id
  secret_id = google_secret_manager_secret.application[each.value.secret_key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime[each.value.service_account_key].email}"
}
