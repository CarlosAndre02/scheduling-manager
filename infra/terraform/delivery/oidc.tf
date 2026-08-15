# How GitHub Actions reaches this account without a stored credential.
#
# The alternative is an IAM user whose access key never expires, is readable by
# every workflow in the repository, and survives being copied. Here the workflow
# presents a short-lived signed token describing the repository, branch and
# event, and STS returns credentials that expire within the hour — see
# docs/ci-cd.md.

# An account holds at most one provider per URL. If another project already
# registered GitHub's, creating it again fails with EntityAlreadyExists and the
# existing one has to be adopted instead of created:
#
#   aws iam list-open-id-connect-providers
#   terraform import aws_iam_openid_connect_provider.github <arn>
resource "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"

  # The audience the trust policy below insists on.
  client_id_list = ["sts.amazonaws.com"]

  # thumbprint_list is deliberately omitted. AWS validates well-known providers
  # against its own trusted CA library rather than a pinned certificate hash, so
  # supplying one only creates something that must be rotated — which is what
  # broke pipelines the last time GitHub changed certificate authorities.
}

# The entire guarantee lives in these two conditions, and either one missing
# gives it away without any visible sign.
data "aws_iam_policy_document" "ci_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    # Without aud the role is open to tokens minted for another audience.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # StringEquals, never StringLike with a wildcard: "repo:owner/*" would admit
    # every repository the owner will ever create. A pull request carries
    # "repo:owner/repo:pull_request" and is refused here, deliberately — a pull
    # request does not publish images.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:ref:refs/heads/${var.github_branch}"]
    }
  }
}

resource "aws_iam_role" "ci" {
  name               = "${var.project}-ci"
  description        = "Assumed by GitHub Actions through OIDC to publish images"
  assume_role_policy = data.aws_iam_policy_document.ci_trust.json
}

data "aws_iam_policy_document" "ci_permissions" {
  # GetAuthorizationToken takes no resource: it is an account-level call, and it
  # is the one `docker login` makes. Scoping it to the repository ARN produces an
  # AccessDenied at login, before any push, with a message that never mentions
  # the repository — which is why it sits in a statement of its own.
  statement {
    sid       = "AuthenticateToRegistry"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # One repository, push path only. No ecr:*, nothing else in the account.
  # A rollout permission is added when there is something to roll out.
  statement {
    sid       = "PublishToThisRepository"
    effect    = "Allow"
    resources = [aws_ecr_repository.app.arn]

    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",

      # So a re-run on an already-published commit can report the tag exists,
      # rather than failing opaquely on the immutable-tag rejection.
      "ecr:DescribeImages",
    ]
  }
}

# Inline rather than a managed policy: it describes what exactly one role may do
# and there is no second role that should ever reuse it. A managed policy would
# be attachable elsewhere by accident.
resource "aws_iam_role_policy" "ci" {
  name   = "ecr-publish"
  role   = aws_iam_role.ci.id
  policy = data.aws_iam_policy_document.ci_permissions.json
}
