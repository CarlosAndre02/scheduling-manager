# For reading and for debugging. Other stacks deliberately do not consume these
# — they look the network up by tag, so they depend on an interface rather than
# on this stack's state. README.md shows the consumer side.

output "vpc_id" {
  description = "Id of the VPC."
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "Public subnets, one per AZ."
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "Private subnets, one per AZ. Both belong in the RDS subnet group."
  value       = aws_subnet.private[*].id
}

output "app_security_group_id" {
  description = "Group for the instance running the reverse proxy and the application."
  value       = aws_security_group.app.id
}

output "db_security_group_id" {
  description = "Group for the database. Accepts 5432 from the application's group only."
  value       = aws_security_group.db.id
}
