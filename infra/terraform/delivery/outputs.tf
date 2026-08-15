output "repository_url" {
  description = "What CI pushes to, and what a deploy pulls from."
  value       = aws_ecr_repository.app.repository_url
}

output "ci_role_arn" {
  description = "Goes into the AWS_CI_ROLE_ARN repository secret on GitHub. Not a credential — the trust policy is what refuses everyone else — but it carries the account id, so it stays out of a public repository."
  value       = aws_iam_role.ci.arn
}
