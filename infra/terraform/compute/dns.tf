# The public name, and only when there is one. Both resources disappear in
# bring-up mode, where the entry point is the raw address below.
#
# The hosted zone is looked up rather than created: a zone is where a domain's
# authority lives, it is billed monthly, and creating one in the wrong place
# produces a zone that answers nothing because the registrar still delegates
# elsewhere.

data "aws_route53_zone" "main" {
  count = local.tls_enabled ? 1 : 0

  name         = "${local.zone_name}."
  private_zone = false
}

resource "aws_route53_record" "app" {
  count = local.tls_enabled ? 1 : 0

  zone_id = data.aws_route53_zone.main[0].zone_id
  name    = var.domain_name
  type    = "A"
  records = [aws_eip.app.public_ip]

  # Short on purpose. This record is how the entry point is replaced — pointing
  # it at a load balancer later, or at a rebuilt instance — and a long TTL turns
  # that from a minute into an afternoon. The extra queries are billed per
  # million and are not the consideration here.
  ttl = 60
}
