terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # State stays local, and here that is permanent rather than provisional: the
  # bucket every other stack stores its state in cannot store its own. The
  # three conditions in docs/terraform.md all hold — one operator, no secret in
  # the state, and a single bucket that `terraform import` adopts back if the
  # file is lost.
}

provider "aws" {
  region = var.region
}
