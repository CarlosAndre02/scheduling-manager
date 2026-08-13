terraform {
  # use_lockfile below is native S3 locking, which arrived in 1.10.
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Bucket and region come from ../backend.hcl at init time: a backend block
  # accepts no variables and no interpolation, and the bucket name carries the
  # account id, which does not belong in a public repository.
  #
  #   terraform init -backend-config=../backend.hcl
  backend "s3" {
    key          = "billing/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  # Budgets and Cost Explorer are global services reached through us-east-1.
  # This says nothing about where the workloads run: these resources cover the
  # whole account, every region.
  region = "us-east-1"
}
