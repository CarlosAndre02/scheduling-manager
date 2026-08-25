# The host: one instance, its address, and everything it needs to know at first
# boot. There is no Auto Scaling group — a failed instance is replaced by hand
# here, which is the trade taken in the README.

locals {
  # Pinned to an exact patch version rather than a moving minor tag: a release
  # is either the bytes that were tested or it is not.
  traefik_image      = "traefik:v3.7.10"
  socket_proxy_image = "tecnativa/docker-socket-proxy:v0.5.0"

  # Bumping the version means bumping the checksum in the same edit — that is
  # the point of recording it, and why the two sit on adjacent lines.
  compose_version = "v5.4.0"
  compose_sha256  = "fc5d1371f1ec7987e703da94ede49af3fbfb240b83f22991a98511de7bc4b93b"

  # Without a hostname there is nothing to put in a certificate, so bring-up
  # mode matches any path and answers plain HTTP on the address below.
  router_rule = local.tls_enabled ? "Host(`${var.domain_name}`)" : "PathPrefix(`/`)"
  entrypoint  = local.tls_enabled ? "websecure" : "web"

  user_data = templatefile("${path.module}/templates/user-data.sh.tftpl", {
    elastic_ip      = aws_eip.app.public_ip
    compose_version = local.compose_version
    compose_sha256  = local.compose_sha256

    compose_yaml = templatefile("${path.module}/templates/docker-compose.yaml.tftpl", {
      project            = var.project
      traefik_image      = local.traefik_image
      socket_proxy_image = local.socket_proxy_image
      tls_enabled        = local.tls_enabled
      router_rule        = local.router_rule
      entrypoint         = local.entrypoint
    })

    traefik_yaml = templatefile("${path.module}/templates/traefik.yaml.tftpl", {
      tls_enabled  = local.tls_enabled
      acme_email   = var.acme_email
      acme_staging = var.acme_staging
    })

    dynamic_yaml = templatefile("${path.module}/templates/dynamic.yaml.tftpl", {
      rate_limit_average = var.rate_limit_average
      rate_limit_burst   = var.rate_limit_burst
      in_flight_limit    = var.in_flight_limit
    })

    deploy_sh = templatefile("${path.module}/templates/deploy.sh.tftpl", {
      region             = var.region
      project            = var.project
      registry           = local.registry
      database_pool_size = var.database_pool_size
    })
  })
}

# Allocated before the instance so its address can be baked into user data,
# which is what lets the boot wait for the association instead of racing it.
#
# Every public IPv4 address is billed by the hour whether attached or not, so
# this is not a saving over an auto-assigned address — it buys a name that
# survives a stop, a start and a replacement.
resource "aws_eip" "app" {
  domain = "vpc"

  tags = {
    Name = "${var.project}-app"
  }
}

resource "aws_instance" "app" {
  ami           = nonsensitive(data.aws_ssm_parameter.ami.value)
  instance_type = var.instance_type
  subnet_id     = local.subnet_id

  vpc_security_group_ids = [data.aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.instance.name

  # The subnet does not hand out public addresses, so this is asked for
  # explicitly. It is needed before the Elastic IP is attached: without a NAT
  # gateway there is no other route out, and user data has packages to fetch.
  associate_public_ip_address = true

  # Compressed, not because 14 kB is large but because EC2 caps user data at
  # 16 kB and the rendered script sits at 86% of it — close enough that adding a
  # comment would fail the apply, with an error that names a size and not a
  # cause. Cloud-init detects the gzip magic and decompresses before running,
  # so nothing on the instance has to know. This costs the plan its readable
  # diff, which the rendered templates in the repository already provide.
  user_data_base64 = base64gzip(local.user_data)

  # False, and not an oversight. Cloud-init runs user data once, on first boot,
  # so a changed template does not reach a running machine either way — the only
  # question is whether Terraform destroys the instance to deliver it. On a
  # single host with no load balancer in front, that is an outage plus a fresh
  # certificate request against a limit of five a week, and it must be a
  # decision rather than a side effect of editing a comment:
  #
  #   terraform apply -replace=aws_instance.app
  user_data_replace_on_change = false

  metadata_options {
    http_endpoint = "enabled"

    # IMDSv2 only. Version 1 answers a plain GET, which turns any
    # request-forgery bug in the application into a read of this instance's
    # role credentials.
    http_tokens = "required"

    # One hop reaches the host and stops there. A container sits behind the
    # Docker bridge, one hop further, so the application cannot read the
    # instance's credentials even though the host can — which matters because
    # that role may pull from the registry and read Parameter Store.
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = var.root_volume_size

    # Costs nothing on gp3 and is the difference between a discarded snapshot
    # being readable and not.
    encrypted = true

    tags = {
      Name = "${var.project}-app-root"
    }
  }

  lifecycle {
    # The AMI parameter resolves to whatever Amazon Linux published most
    # recently, and the attribute forces replacement. Without this, an apply
    # months from now that changes nothing else still proposes destroying the
    # only production host. Upgrading the operating system stays possible and
    # becomes deliberate: -replace, having read what the new image contains.
    ignore_changes = [ami]
  }

  tags = {
    Name = "${var.project}-app"
  }
}

resource "aws_eip_association" "app" {
  instance_id   = aws_instance.app.id
  allocation_id = aws_eip.app.id
}
