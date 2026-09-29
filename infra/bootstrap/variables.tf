variable "project_id" {
  description = "Existing Google Cloud project ID. Project creation and billing remain owner-managed."
  type        = string
}

variable "state_bucket_name" {
  description = "Globally unique, owner-selected name for the Terraform state bucket."
  type        = string

  validation {
    condition     = length(var.state_bucket_name) >= 3 && length(var.state_bucket_name) <= 63
    error_message = "state_bucket_name must be a valid 3-63 character GCS bucket name."
  }
}

variable "github_repository_id" {
  description = "Numeric GitHub repository ID for rengedo01-stack/lotus-brain."
  type        = string

  validation {
    condition     = can(regex("^[0-9]+$", var.github_repository_id))
    error_message = "github_repository_id must be the numeric GitHub repository ID."
  }
}

variable "github_repository_owner_id" {
  description = "Numeric GitHub organization or owner ID for rengedo01-stack."
  type        = string

  validation {
    condition     = can(regex("^[0-9]+$", var.github_repository_owner_id))
    error_message = "github_repository_owner_id must be the numeric GitHub owner ID."
  }
}

variable "region" {
  description = "Google Cloud region for regional foundation resources."
  type        = string
  default     = "asia-northeast1"
}

variable "environment" {
  description = "Deployment environment label."
  type        = string
  default     = "production"
}

variable "system_name" {
  description = "System label shared by managed resources."
  type        = string
  default     = "lotus-brain"
}
