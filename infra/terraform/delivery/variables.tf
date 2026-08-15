variable "project" {
  description = "Names the ECR repository and prefixes the CI role."
  type        = string
  default     = "scheduling-manager"
}

variable "region" {
  description = "Where the registry lives. Pulling from it is free only from the same region."
  type        = string
  default     = "us-east-1"
}

# Deliberately without a default. This value is the entire access boundary, and
# a fork that inherited it would grant the original repository the right to push.
variable "github_repository" {
  description = "The repository allowed to assume the CI role, as owner/repository."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$", var.github_repository))
    error_message = "Must be owner/repository — the form GitHub uses in the sub claim."
  }
}

variable "github_branch" {
  description = "The only branch whose workflow runs may assume the role. Pull requests carry a different sub claim and are refused."
  type        = string
  default     = "main"
}

variable "image_retention_count" {
  description = "How many images to keep. Must exceed the rollback window: an image expired is a release that can no longer be redeployed."
  type        = number
  default     = 30

  validation {
    condition     = var.image_retention_count >= 10
    error_message = "Fewer than 10 leaves no useful rollback window."
  }
}

variable "untagged_retention_days" {
  description = "How long untagged images survive. They are orphaned layers left behind when a tag's build is replaced."
  type        = number
  default     = 7
}
