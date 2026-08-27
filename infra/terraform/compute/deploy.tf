# How a release reaches the instance.
#
# The deploy script itself lives on the host, delivered by user data. What this
# adds is the one way to trigger it from outside: no port, no key pair, and a
# CloudTrail entry naming who ran it.

resource "aws_ssm_document" "deploy" {
  name            = "${var.project}-deploy"
  document_type   = "Command"
  document_format = "YAML"

  # No parameters, deliberately. The caller chooses *when* a deploy happens and
  # never *what* it runs — the command is fixed here and the release it installs
  # comes from Parameter Store.
  #
  # The alternative is the AWS-owned AWS-RunShellScript, which takes the command
  # as an argument. Granting SendCommand on it grants arbitrary root execution on
  # the host, so the deploy permission and a shell would be the same permission.
  # Here they are not: this document runs one script, and a shell is a separate
  # grant through Session Manager.
  content = yamlencode({
    schemaVersion = "2.2"
    description   = "Installs the release named by /${var.project}/image-tag."

    mainSteps = [{
      action = "aws:runShellScript"
      name   = "deploy"

      inputs = {
        runCommand = ["/opt/app/deploy.sh"]

        # Generous against a cold pull on a burstable instance, and still an
        # upper bound — a wedged deploy fails rather than holding the caller.
        timeoutSeconds = "600"
      }
    }]
  })

  tags = {
    Name = "${var.project}-deploy"
  }
}
