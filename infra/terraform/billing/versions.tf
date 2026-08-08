terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # State stays local. This stack holds no secrets, is a handful of resources,
  # and has to exist before any bucket does — a remote backend would need
  # infrastructure provisioned before the guardrail protecting it.
}

provider "aws" {
  # Budgets and Cost Explorer are global services reached through us-east-1.
  # This says nothing about where the workloads run: these resources cover the
  # whole account, every region.
  region = "us-east-1"
}
