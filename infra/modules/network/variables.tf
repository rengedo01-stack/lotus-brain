variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "network_name" {
  type = string
}

variable "app_subnet_cidr" {
  type = string
}

variable "worker_subnet_cidr" {
  type = string
}

variable "private_services_access_cidr" {
  type = string

  validation {
    condition     = can(cidrhost(var.private_services_access_cidr, 0))
    error_message = "private_services_access_cidr must be a valid CIDR range."
  }
}
