# The bucket every other stack keeps its state in.
#
# Object Lock is deliberately absent, unlike the audit bucket next door.
# Terraform overwrites the state object on every apply, and a retention lock
# would make the second apply fail. Versioning is what protects this bucket:
# every overwrite leaves the previous state recoverable.

data "aws_caller_identity" "current" {}

locals {
  # S3 bucket names are globally unique across all AWS customers. Suffixing
  # with the account id makes the stack apply on a new account without anyone
  # having to invent a free name.
  bucket_name = "tfstate-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket" "state" {
  bucket = local.bucket_name

  # Destroying this bucket makes every other stack forget what it created and
  # propose creating all of it again. No plan should be able to reach it, least
  # of all by accident.
  lifecycle {
    prevent_destroy = true
  }
}

# Not optional. State is overwritten in place, so versioning is the only way
# back from a corrupted file or an apply that recorded the wrong thing — and it
# is what the lifecycle rule below is written against.
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# SSE-S3 rather than KMS. Both satisfy "encrypted at rest", and at-rest
# encryption is not the control that matters here: state holds secrets in plain
# text, so what actually protects them is who may call GetObject. A customer
# managed key earns its place once more than one principal can read the bucket
# — a second operator, or a CI role running Terraform — because kms:Decrypt is
# then a second gate, denied separately and logged separately.
resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Every apply writes a new version, so without this the bucket grows for as
# long as the project lives. Incomplete multipart uploads are billed as storage
# and are invisible in the console, which is why they are swept too.
resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    id     = "expire-superseded-state"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.state_retention_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.state]
}

# S3 accepts plain HTTP unless told otherwise, and this state travels with
# database credentials inside it.
data "aws_iam_policy_document" "state" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]

    resources = [
      aws_s3_bucket.state.arn,
      "${aws_s3_bucket.state.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = data.aws_iam_policy_document.state.json

  # S3 evaluates a new bucket policy against the public access block, so the
  # block has to be settled before the policy is written. Terraform sees no
  # dependency between the two on its own and would order them arbitrarily.
  depends_on = [aws_s3_bucket_public_access_block.state]
}
