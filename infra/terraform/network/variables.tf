variable "project" {
  description = "Prefix for resource names, and the value other stacks look this network up by."
  type        = string
  default     = "scheduling-manager"
}

variable "region" {
  description = "Where the network and everything inside it lives."
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "Address range for the VPC. Fixed at creation — changing it rebuilds the network and everything in it."
  type        = string
  default     = "10.0.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0)) && tonumber(split("/", var.vpc_cidr)[1]) <= 16
    error_message = "Must be a valid CIDR block of /16 or larger, since the subnets below are carved out of it as /24s."
  }
}
