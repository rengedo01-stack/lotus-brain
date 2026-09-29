variable "project_id" {
  description = "Existing owner-managed Google Cloud project ID."
  type        = string
}

variable "region" {
  description = "Regional location for Lotus BRAIN production infrastructure."
  type        = string
  default     = "asia-northeast1"
}

variable "environment" {
  description = "Deployment environment label."
  type        = string
  default     = "production"
}

variable "system_name" {
  description = "System label and resource-name prefix."
  type        = string
  default     = "lotus-brain"
}

variable "app_subnet_cidr" {
  description = "Application subnet CIDR."
  type        = string
  default     = "10.70.0.0/24"
}

variable "worker_subnet_cidr" {
  description = "Worker subnet CIDR."
  type        = string
  default     = "10.70.1.0/24"
}

variable "private_services_access_cidr" {
  description = "Reserved Private Services Access CIDR."
  type        = string
  default     = "10.70.16.0/20"
}
