variable "alert_email" {
  description = "Address every cost alert is delivered to."
  type        = string
}

variable "warning_usd" {
  description = "Monthly spend at which the first warning email is sent."
  type        = number
  default     = 8

  validation {
    condition     = var.warning_usd < var.ceiling_usd
    error_message = "warning_usd must be below ceiling_usd, otherwise the first warning never precedes the second."
  }
}

variable "ceiling_usd" {
  description = "Budget limit, and the spend at which the second warning is sent. Nothing enforces it — see docs/aws-governance.md."
  type        = number
  default     = 12
}

variable "anomaly_impact_usd" {
  description = "Smallest dollar impact worth reporting as an anomaly."
  type        = number
  default     = 2
}
