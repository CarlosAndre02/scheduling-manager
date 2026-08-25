# What the instance is allowed to do, which is deliberately close to nothing:
# pull one repository, read its own parameters, and accept a Session Manager
# connection. No key pair exists, so this role is also the only way in.

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "instance_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "instance" {
  name               = "${var.project}-instance"
  description        = "Assumed by the application instance to pull its image and read its configuration"
  assume_role_policy = data.aws_iam_policy_document.instance_trust.json
}

# Session Manager instead of SSH: no port 22 open, no key pair to distribute or
# lose, and every session recorded in CloudTrail. The agent connects outbound,
# so nothing is listening for it. docs/vpc.md covers what it replaces.
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "instance_permissions" {
  # Account-level and resource-less, exactly as in the CI role: this is the call
  # `docker login` makes, and scoping it to a repository fails at login with a
  # message that never names the repository.
  statement {
    sid       = "AuthenticateToRegistry"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # Pull only. The instance has no reason to push, and an instance that could
  # push is one that can replace the image it is about to run.
  statement {
    sid       = "PullThisRepository"
    effect    = "Allow"
    resources = [data.aws_ecr_repository.app.arn]

    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
    ]
  }

  # Scoped to this project's prefix, so a parameter belonging to anything else
  # in the account stays unreadable.
  statement {
    sid     = "ReadOwnParameters"
    effect  = "Allow"
    actions = ["ssm:GetParameter", "ssm:GetParameters"]

    resources = [
      "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/${var.project}/*",
    ]
  }

  # The database URL is a SecureString under the AWS managed key, which cannot
  # be named here: alias/aws/ssm does not exist until the account's first
  # SecureString is written, so a data source lookup would fail on a clean
  # account. The ViaService condition is the equivalent restriction — decryption
  # is permitted only when Parameter Store is the one asking.
  statement {
    sid       = "DecryptParametersThroughSsmOnly"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "instance" {
  name   = "run-the-application"
  role   = aws_iam_role.instance.id
  policy = data.aws_iam_policy_document.instance_permissions.json
}

resource "aws_iam_instance_profile" "instance" {
  name = "${var.project}-instance"
  role = aws_iam_role.instance.name
}
