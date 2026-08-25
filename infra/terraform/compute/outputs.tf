output "public_ip" {
  description = "The Elastic IP. Stable across a stop, a start and a replacement, and the address to allowlist in the database provider's network restrictions."
  value       = aws_eip.app.public_ip
}

output "instance_id" {
  description = "For Session Manager and for Run Command."
  value       = aws_instance.app.id
}

output "url" {
  description = "Where the application answers."
  value       = var.domain_name != "" ? "https://${var.domain_name}" : "http://${aws_eip.app.public_ip}"
}

output "connect_command" {
  description = "A shell on the instance without an open port or a key pair. Requires the Session Manager plugin for the AWS CLI."
  value       = "aws ssm start-session --region ${var.region} --target ${aws_instance.app.id}"
}

output "deploy_command" {
  description = "Applies whatever the image-tag parameter currently says. Run it after any apply that changed image_tag or app_replicas — Terraform moves the parameter, this moves the containers."
  value       = "aws ssm send-command --region ${var.region} --document-name AWS-RunShellScript --instance-ids ${aws_instance.app.id} --parameters 'commands=[\"/opt/app/deploy.sh\"]'"
}
