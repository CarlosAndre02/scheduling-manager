terraform {
  # use_lockfile below is native S3 locking, which arrived in 1.10.
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Bucket and region come from ../backend.hcl at init time — see the billing
  # stack, or bootstrap/README.md for why.
  #
  #   terraform init -backend-config=../backend.hcl
  backend "s3" {
    key          = "audit/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region
}
