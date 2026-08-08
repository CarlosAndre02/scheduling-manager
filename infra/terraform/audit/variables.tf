variable "region" {
  description = "Home region for the trail. A multi-region trail records every region regardless; this only decides where the trail and its bucket live."
  type        = string
  default     = "us-east-1"
}

variable "trail_name" {
  description = "Name of the CloudTrail trail."
  type        = string
  default     = "account-activity"
}

variable "retention_days" {
  description = "How long log files stay locked and undeletable."
  type        = number
  default     = 365

  validation {
    condition     = var.retention_days >= 90
    error_message = "Below 90 days the free CloudTrail event history already covers the window, so a trail adds nothing."
  }
}
