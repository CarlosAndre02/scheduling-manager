output "bucket" {
  description = "Name of the state bucket."
  value       = aws_s3_bucket.state.id
}

output "backend_hcl" {
  description = "Contents of infra/terraform/backend.hcl, the file every other stack passes to `terraform init -backend-config`."

  value = <<-EOT
    bucket = "${aws_s3_bucket.state.id}"
    region = "${var.region}"
  EOT
}
