variable "region" {
  description = "Where the state bucket lives. Independent of where workloads run — every stack reaches it over the S3 API."
  type        = string
  default     = "us-east-1"
}

variable "state_retention_days" {
  description = "How long a superseded state version is kept. This is the window available to recover from an apply that recorded the wrong thing."
  type        = number
  default     = 90

  validation {
    condition     = var.state_retention_days >= 30
    error_message = "A shorter window than 30 days can expire the only good copy before anyone notices the state is wrong."
  }
}
