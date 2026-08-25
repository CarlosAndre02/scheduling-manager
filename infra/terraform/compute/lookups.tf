# What this stack consumes from the others.
#
# By tag and by name, never through terraform_remote_state: reading another
# stack's state couples this one to that stack's internal layout and needs read
# access to a file that holds secrets. A tag is a narrower, deliberate interface
# — and a load-bearing one, so it cannot be renamed casually. See
# docs/aws-stack-implementation.md.

data "aws_vpc" "main" {
  filter {
    name   = "tag:Name"
    values = ["${var.project}-vpc"]
  }
}

# Public, because there is no NAT gateway: the instance reaches ECR, Systems
# Manager, Let's Encrypt and the database through the internet gateway, which
# requires a routable address of its own. docs/vpc.md has the trade in full.
data "aws_subnets" "public" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.main.id]
  }

  filter {
    name   = "tag:Tier"
    values = ["public"]
  }
}

data "aws_security_group" "app" {
  vpc_id = data.aws_vpc.main.id

  filter {
    name   = "tag:Name"
    values = ["${var.project}-app"]
  }
}

data "aws_ecr_repository" "app" {
  name = var.project
}

# Published by AWS and updated whenever a new Amazon Linux 2023 image ships, so
# this resolves to a different id over time. instance.tf ignores changes to it
# on purpose — see the comment there.
data "aws_ssm_parameter" "ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

locals {
  subnet_id = sort(data.aws_subnets.public.ids)[0]

  registry = split("/", data.aws_ecr_repository.app.repository_url)[0]

  # The pooler's ceiling divided across the containers that share it. Deriving
  # it rather than declaring it per container is what stops `app_replicas = 4`
  # from quietly asking for four times the connections the pooler will give.
  database_pool_max = floor(var.database_pool_size / var.app_replicas)

  tls_enabled = var.domain_name != ""

  # The registrable part of the hostname — api.example.com lives in the
  # example.com zone. Guarded against the empty domain so the expression is not
  # evaluated in bring-up mode, and overridable because a zone delegated deeper
  # than the second level breaks the assumption.
  zone_name = var.domain_name == "" ? "" : (
    var.route53_zone_name != "" ? var.route53_zone_name : join(".", slice(split(".", var.domain_name), max(0, length(split(".", var.domain_name)) - 2), length(split(".", var.domain_name))))
  )
}
