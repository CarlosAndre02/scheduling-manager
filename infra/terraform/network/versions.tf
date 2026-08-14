terraform {
  # use_lockfile below is native S3 locking, which arrived in 1.10.
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Bucket and region come from ../backend.hcl at init time — see the bootstrap
  # stack's README for why.
  #
  #   terraform init -backend-config=../backend.hcl
  backend "s3" {
    key          = "network/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  # Unlike the billing and audit stacks, this one is regional in the ordinary
  # sense: every resource here exists in one region and nowhere else.
  region = var.region
}
