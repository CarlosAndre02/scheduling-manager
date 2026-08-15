# The chain. Two links, because a security group attaches to a network
# interface: the reverse proxy and the application share a host, so no boundary
# exists between them for a group to describe. A third link appears in front on
# the day the proxy moves onto a load balancer — see docs/vpc.md.
#
#   internet --443--> [app] --5432--> [db]
#                              source: app

# AWS creates a default group in every VPC allowing all traffic between its own
# members and all traffic outbound, and it cannot be deleted. Adopting it with
# no rule blocks is what empties it, so nothing landing in it by accident
# inherits an open network.
resource "aws_default_security_group" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.project}-default-do-not-use"
  }
}

resource "aws_security_group" "app" {
  # name_prefix rather than name: editing the description forces replacement,
  # and a group still attached to an instance cannot be deleted — so the
  # replacement has to be created first, under a name that does not collide.
  name_prefix = "${var.project}-app-"
  description = "Instance running the reverse proxy and the application"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${var.project}-app"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# When a load balancer is introduced, this is the rule that changes: cidr_ipv4
# becomes referenced_security_group_id pointing at its group, and the world
# reaches the load balancer instead. Nothing else in this file moves.
resource "aws_vpc_security_group_ingress_rule" "app_https" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  description       = "HTTPS from the internet"
}

# Port 80 does not serve traffic: it redirects to 443 and answers Let's
# Encrypt's HTTP-01 challenge. Closing it means switching the proxy to the
# TLS-ALPN-01 challenge, which needs only 443.
resource "aws_vpc_security_group_ingress_rule" "app_http" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  description       = "HTTP, for the redirect and the ACME challenge"
}

# Declared rather than assumed. AWS attaches an allow-all egress rule to every
# new group, and Terraform removes it when the configuration defines none —
# the workload then reaches nothing outbound, with a timeout as the only clue.
#
# A rule description accepts only `a-zA-Z0-9. _-:/()#,@[]+=&;{}!$*`, so an
# apostrophe is rejected at apply time. `terraform validate` cannot see this:
# the constraint lives in the EC2 API, not in the schema.
resource "aws_vpc_security_group_egress_rule" "app_all" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
  description       = "Outbound to ECR, Systems Manager, ACME and package mirrors"
}

resource "aws_security_group" "db" {
  name_prefix = "${var.project}-db-"
  description = "PostgreSQL, reachable only from the application"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${var.project}-db"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# No address appears here. Membership is evaluated live against the interfaces
# in the application's group, so replacing the instance, adding a second one, or
# moving to Fargate is already covered — and there is no IP to impersonate,
# because the rule contains none.
resource "aws_vpc_security_group_ingress_rule" "db_from_app" {
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "PostgreSQL from the application"
}

# The database has no egress rule at all, deliberately. RDS does not open
# outbound connections in normal operation: backups, monitoring and log export
# travel over the service plane rather than this interface. Enabling a feature
# that does reach out, such as S3 export, would mean adding one.
