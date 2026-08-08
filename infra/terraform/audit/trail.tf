# The trail, and the bucket policy that lets it write.

locals {
  # Built as a string rather than read from aws_cloudtrail.main.arn: the trail
  # cannot be created until the bucket policy allows it to write, so referencing
  # the trail resource here would close a cycle in the dependency graph.
  trail_arn = "arn:aws:cloudtrail:${var.region}:${data.aws_caller_identity.current.account_id}:trail/${var.trail_name}"
}

data "aws_iam_policy_document" "trail" {
  # CloudTrail checks it can write before it writes.
  statement {
    sid       = "AclCheck"
    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.trail.arn]

    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [local.trail_arn]
    }
  }

  statement {
    sid       = "WriteLogs"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.trail.arn}/AWSLogs/${data.aws_caller_identity.current.account_id}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }

    # Without this, another customer's trail could name this bucket as its
    # destination and CloudTrail would write on their behalf.
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [local.trail_arn]
    }
  }

  # Answers "is data encrypted in transit" with a control rather than a claim.
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]

    resources = [
      aws_s3_bucket.trail.arn,
      "${aws_s3_bucket.trail.arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "trail" {
  bucket = aws_s3_bucket.trail.id
  policy = data.aws_iam_policy_document.trail.json
}

resource "aws_cloudtrail" "main" {
  name           = var.trail_name
  s3_bucket_name = aws_s3_bucket.trail.id

  # Activity in an unmonitored region would go unrecorded, which is exactly
  # where someone who should not be there would operate.
  is_multi_region_trail = true

  # IAM, STS and CloudFront only emit events in us-east-1.
  include_global_service_events = true

  # Writes digest files containing hashes of the delivered logs, so tampering
  # can be detected rather than merely discouraged. This is the control a
  # security questionnaire is asking about.
  enable_log_file_validation = true

  # Data events (S3 object reads, Lambda invocations) are deliberately absent.
  # They are billed per event and scale with traffic rather than with
  # administrative activity, which is what an audit trail is for.

  depends_on = [aws_s3_bucket_policy.trail]
}
