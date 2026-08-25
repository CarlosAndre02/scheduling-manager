# Runtime configuration, kept out of the instance so that changing it does not
# mean rebuilding the machine.
#
# Cloud-init runs user data once, at first boot. Anything baked into it can only
# be changed by replacing the instance — which for this stack means a new
# certificate request against a weekly limit of five. So what a deploy changes
# lives here and is read at deploy time; what the machine *is* lives in user
# data and legitimately justifies a replacement.
#
# Standard parameters are free and there are three of them.

resource "aws_ssm_parameter" "image_tag" {
  name        = "/${var.project}/image-tag"
  description = "The image tag the next deploy will run. Updating this does not restart anything — see the compute stack README."
  type        = "String"
  value       = var.image_tag
}

resource "aws_ssm_parameter" "app_replicas" {
  name        = "/${var.project}/app-replicas"
  description = "How many application containers to run behind the proxy."
  type        = "String"
  value       = tostring(var.app_replicas)
}

# The database URL is deliberately absent.
#
# Every attribute of every resource is stored in state in plain text, so a
# password managed here would sit unencrypted in the state file and in every
# plan output that touched it. Creating it outside Terraform keeps the one real
# secret in this system out of state entirely; the role above grants read access
# by path, so the permission is declared without the value ever being.
#
#   aws ssm put-parameter \
#     --name /scheduling-manager/database-url \
#     --type SecureString \
#     --value '<the Supavisor session-mode URL, with no sslmode>'
#
# Both qualifiers matter and neither fails loudly: transaction mode breaks the
# migration advisory lock, and any sslmode in the URL makes pg discard the
# certificate authority. docs/supabase.md explains both.
