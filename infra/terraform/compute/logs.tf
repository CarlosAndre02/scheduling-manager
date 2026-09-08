# Where container output goes once it leaves the instance.
#
# The property that matters is surviving the host: replacing the instance is a
# routine operation here — it is how a template change is delivered and how the
# operating system is upgraded — so logs kept only on its disk are lost on a
# normal Tuesday rather than in a disaster.

resource "aws_cloudwatch_log_group" "app" {
  name = "/${var.project}"

  # Not optional, and not a default worth inheriting: a log group with no
  # retention keeps every byte for the life of the account, and storage is
  # billed monthly. This is the only place that number is decided.
  retention_in_days = var.log_retention_days

  tags = {
    Name = var.project
  }
}
