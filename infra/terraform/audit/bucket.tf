# Where the log files live, and what stops them from being tampered with.

data "aws_caller_identity" "current" {}

locals {
  # S3 bucket names are globally unique across all AWS customers. Suffixing
  # with the account id makes the stack apply on a new account without anyone
  # having to invent a free name.
  bucket_name = "cloudtrail-${data.aws_caller_identity.current.account_id}"

  # The retention window plus a margin, so the lock has always expired by the
  # time the lifecycle rule tries to delete anything.
  expire_after_days = var.retention_days + 30
}

resource "aws_s3_bucket" "trail" {
  bucket = local.bucket_name

  # Enabling Object Lock at creation is the clean path. Once on, it cannot be
  # turned off and versioning can no longer be suspended.
  object_lock_enabled = true
}

# Object Lock requires versioning, and versioning is what the lifecycle rules
# below are written against.
resource "aws_s3_bucket_versioning" "trail" {
  bucket = aws_s3_bucket.trail.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "trail" {
  bucket = aws_s3_bucket.trail.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# SSE-S3 rather than KMS: both satisfy "encrypted at rest", and a customer
# managed key costs more per month than this entire stack.
resource "aws_s3_bucket_server_side_encryption_configuration" "trail" {
  bucket = aws_s3_bucket.trail.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# GOVERNANCE, never COMPLIANCE. Under compliance mode no one can delete a
# locked object before its date — not even the root user — and the only escape
# is closing the AWS account. Governance blocks deletion just as effectively
# while leaving a deliberate, permissioned way out.
resource "aws_s3_bucket_object_lock_configuration" "trail" {
  bucket = aws_s3_bucket.trail.id

  rule {
    default_retention {
      mode = "GOVERNANCE"
      days = var.retention_days
    }
  }
}

# Two steps are needed because the bucket is versioned: expiration only adds a
# delete marker and turns the log file into a noncurrent version, which is what
# actually gets removed. Skipping the second rule keeps paying for storage
# forever while the console shows an empty bucket.
resource "aws_s3_bucket_lifecycle_configuration" "trail" {
  bucket = aws_s3_bucket.trail.id

  rule {
    id     = "expire-logs"
    status = "Enabled"

    filter {}

    expiration {
      days = local.expire_after_days
    }

    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }

  depends_on = [aws_s3_bucket_versioning.trail]
}
