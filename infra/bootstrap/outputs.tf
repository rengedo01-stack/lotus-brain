output "state_bucket_name" {
  description = "Terraform state bucket name."
  value       = google_storage_bucket.terraform_state.name
}

output "workload_identity_pool_name" {
  description = "Full GitHub Actions Workload Identity Pool resource name."
  value       = google_iam_workload_identity_pool.github.name
}

output "workload_identity_provider_name" {
  description = "Full GitHub Actions Workload Identity Provider resource name."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "terraform_release_service_account_email" {
  description = "Federated release service-account email."
  value       = google_service_account.terraform_release.email
}

output "terraform_apply_service_account_email" {
  description = "Production Terraform apply service-account email. This identity receives no GitHub WIF binding."
  value       = google_service_account.terraform_apply.email
}
