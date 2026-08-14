# The VPC, its subnets, and what does or does not have a route out.
#
# Nothing in this file is billable. The internet gateway, the subnets, the route
# tables and the S3 gateway endpoint are all free, which is what lets this stack
# be applied and left standing before any compute exists.

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  # Two AZs, because an RDS subnet group demands two even for a Single-AZ
  # instance, and a load balancer would demand two later. The names are per
  # account rather than physical, and the list is sorted and stable — but
  # changing a subnet's AZ destroys and recreates it, so this is not somewhere
  # to make a casual edit.
  azs = slice(data.aws_availability_zones.available.names, 0, 2)

  # /24s carved out of the VPC range. The gap between the public and private
  # blocks leaves room for a third public subnet without renumbering anything.
  public_cidrs  = [for i in range(2) : cidrsubnet(var.vpc_cidr, 8, i)]
  private_cidrs = [for i in range(2) : cidrsubnet(var.vpc_cidr, 8, i + 10)]
}

resource "aws_vpc" "main" {
  cidr_block = var.vpc_cidr

  # enable_dns_hostnames is *not* the default on a VPC you create, and much
  # depends on it: without it instances get no internal DNS name, and the RDS
  # endpoint stops resolving to a private address from inside the VPC — the
  # connection then leaves through the internet gateway and is billed as data
  # transfer. See docs/vpc.md on split-horizon resolution.
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "${var.project}-vpc"
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.project}-igw"
  }
}

# Tier is a deliberate interface, not decoration: other stacks select subnets by
# role through it rather than by name — see README.md.
resource "aws_subnet" "public" {
  count = 2

  vpc_id            = aws_vpc.main.id
  cidr_block        = local.public_cidrs[count.index]
  availability_zone = local.azs[count.index]

  # A public address is a decision each instance makes, not something a subnet
  # hands out. This is the default VPC's most costly convenience, and leaving it
  # off means nothing becomes reachable from the internet by omission.
  map_public_ip_on_launch = false

  tags = {
    Name = "${var.project}-public-${local.azs[count.index]}"
    Tier = "public"
  }
}

resource "aws_subnet" "private" {
  count = 2

  vpc_id            = aws_vpc.main.id
  cidr_block        = local.private_cidrs[count.index]
  availability_zone = local.azs[count.index]

  tags = {
    Name = "${var.project}-private-${local.azs[count.index]}"
    Tier = "private"
  }
}

# The default route to the internet gateway is the only thing that makes a
# subnet public.
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name = "${var.project}-public"
  }
}

# No default route, and declared explicitly rather than letting these subnets
# fall back to the VPC's main route table: a route added to that table would
# reach every subnet not associated with another one, which is how a private
# subnet becomes public by accident.
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.project}-private"
  }
}

resource "aws_route_table_association" "public" {
  count = 2

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count = 2

  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# Free, and it keeps ECR layer pulls and any other S3 traffic on the AWS network
# instead of routing out through the internet gateway. The interface endpoints
# that would do the same for other services are billed per AZ — docs/vpc.md
# explains why that difference decides the whole option.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"

  route_table_ids = [
    aws_route_table.public.id,
    aws_route_table.private.id,
  ]

  tags = {
    Name = "${var.project}-s3"
  }
}
