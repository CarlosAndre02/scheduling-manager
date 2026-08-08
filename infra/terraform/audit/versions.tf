terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # State stays local, for the same reasons as the billing stack — see
  # docs/terraform.md. Nothing here is sensitive: the state records bucket and
  # trail configuration, never log contents.
}

provider "aws" {
  region = var.region
}
