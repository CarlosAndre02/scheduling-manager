# Where images land, and what stops the registry growing forever.

resource "aws_ecr_repository" "app" {
  name = var.project

  # A tag that can be repointed makes a release irreproducible. Under IMMUTABLE
  # the registry refuses a second push of an existing tag, so a tag always names
  # the same bytes — which is what makes rollback a lookup rather than a rebuild.
  #
  # The setting is repository-wide, so a moving `latest` cannot coexist with it.
  # That is the intended consequence: which image is deployed belongs to the
  # deploy, not to a tag that moves underneath it.
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    # Free, and a second opinion at the registry. It covers operating system
    # packages only, so it does not replace the Trivy job in CI — language
    # packages need enhanced scanning, which is billed per image scanned.
    scan_on_push = true
  }

  # Encryption is left at the default AES256. A customer managed key would add a
  # per-request charge and a key policy to maintain, protecting images that are
  # built from a public repository and hold no secret.
}

# Rules are evaluated in priority order and an image is acted on by the first
# one that matches it, which is why the catch-all comes last: a `tagStatus` of
# `any` in first position would swallow every image before the untagged rule
# ever ran.
#
# Expiry is asynchronous, within roughly a day. An unchanged console right after
# apply is expected, not a failure.
resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Untagged images are orphaned layers from replaced builds"

        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = var.untagged_retention_days
        }

        action = { type = "expire" }
      },
      {
        # `any` avoids the tagPrefixList that `tagged` would require, and counts
        # by push date rather than by name.
        rulePriority = 2
        description  = "Keep the newest images, expire the rest"

        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = var.image_retention_count
        }

        action = { type = "expire" }
      },
    ]
  })
}
