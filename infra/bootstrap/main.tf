terraform {
  required_version = "= 1.16.4"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.2.0"
    }
  }

  backend "gcs" {}
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  labels = {
    system      = var.system_name
    environment = var.environment
    managed-by  = "terraform"
    component   = "bootstrap"
  }

  required_services = toset([
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "storage.googleapis.com",
  ])
}

resource "google_project_service" "bootstrap" {
  for_each = local.required_services

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_storage_bucket" "terraform_state" {
  name                        = var.state_bucket_name
  project                     = var.project_id
  location                    = var.region
  force_destroy               = false
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  labels                      = local.labels

  versioning {
    enabled = true
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.bootstrap["storage.googleapis.com"]]
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "lotus-brain-github"
  display_name              = "Lotus BRAIN GitHub Actions"
  description               = "Short-lived GitHub Actions identities for Lotus BRAIN."
  disabled                  = false

  depends_on = [google_project_service.bootstrap["iam.googleapis.com"]]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub Actions OIDC"
  description                        = "Restricts GitHub OIDC to the protected Lotus BRAIN main branch."
  attribute_condition                = "assertion.repository_id == '${var.github_repository_id}' && assertion.repository_owner_id == '${var.github_repository_owner_id}' && assertion.ref == 'refs/heads/main'"

  attribute_mapping = {
    "google.subject"                = "assertion.sub"
    "attribute.repository_id"       = "assertion.repository_id"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
    "attribute.ref"                 = "assertion.ref"
  }

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }

  depends_on = [google_project_service.bootstrap["sts.googleapis.com"]]
}

resource "google_service_account" "terraform_release" {
  project      = var.project_id
  account_id   = "lotus-brain-release"
  display_name = "Lotus BRAIN production release"
  description  = "Federated GitHub Actions release identity; it never performs Terraform infrastructure applies."

  depends_on = [google_project_service.bootstrap["iam.googleapis.com"]]
}

resource "google_service_account" "terraform_apply" {
  project      = var.project_id
  account_id   = "lotus-brain-terraform"
  display_name = "Lotus BRAIN production Terraform apply"
  description  = "Infrastructure apply identity impersonated only by owner-approved human operators; it has no WIF binding or service-account key."

  depends_on = [google_project_service.bootstrap["iam.googleapis.com"]]
}

resource "google_service_account_iam_member" "github_workload_identity_user" {
  service_account_id = google_service_account.terraform_release.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository_id/${var.github_repository_id}"

  depends_on = [google_project_service.bootstrap["iamcredentials.googleapis.com"]]
}
