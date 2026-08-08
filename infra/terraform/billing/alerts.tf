# Cost guardrails: they warn, they never act.
#
# Applies to the management (payer) account: consolidated billing rolls member
# account spend up to the payer, so one budget covers the whole organization.
#
# There is deliberately no automated shutdown. AWS budget actions only stop
# instances named by ID, hours after the threshold is crossed, and a stopped
# RDS instance restarts itself a week later — so the outage lands on paying
# users while the bill resumes anyway. Spending is bounded by architecture and
# by IAM, not by a billing threshold. docs/aws-governance.md has the reasoning.

# Credits and refunds are deliberately excluded from every budget below, so the
# thresholds measure *gross* spend. With a promotional credit applied the net
# cost reads $0 and no threshold would fire until the credit ran out — the one
# moment a warning is worthless.

# The first cent charged sends an email. Free-tier usage produces no charge, so
# this stays quiet until something genuinely bills.
resource "aws_budgets_budget" "zero_spend" {
  name         = "zero-spend"
  budget_type  = "COST"
  limit_amount = "0.01"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_types {
    include_credit = false
    include_refund = false
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 0.01
    threshold_type             = "ABSOLUTE_VALUE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
}

# The real ceiling. Thresholds are absolute dollars rather than percentages so
# the file says what it means, and so moving the ceiling does not silently move
# the warning with it.
resource "aws_budgets_budget" "ceiling" {
  name         = "monthly-ceiling"
  budget_type  = "COST"
  limit_amount = tostring(var.ceiling_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_types {
    include_credit = false
    include_refund = false
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = var.warning_usd
    threshold_type             = "ABSOLUTE_VALUE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  # Fires while there is still time to react, but AWS needs roughly five weeks
  # of history before it can forecast — inert on a new account, not broken.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = var.warning_usd
    threshold_type             = "ABSOLUTE_VALUE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }

  # The ceiling itself, as a second and louder warning.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = var.ceiling_usd
    threshold_type             = "ABSOLUTE_VALUE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
}

# A budget catches the slow climb toward a number you picked. This catches a
# jump that stays under it — spend that stops resembling its own history.
#
# This resource must be IMPORTED, never created. Enabling Cost Explorer makes
# AWS create a SERVICE monitor on its own, and an account may hold only one, so
# `apply` on a fresh account fails with "Limit exceeded on dimensional spend
# monitor creation" until the existing monitor is adopted:
#
#   aws ce get-anomaly-monitors --query 'AnomalyMonitors[].[MonitorArn,MonitorName]' --output table
#   terraform import aws_ce_anomaly_monitor.services <arn>
resource "aws_ce_anomaly_monitor" "services" {
  name              = "all-services"
  monitor_type      = "DIMENSIONAL"
  monitor_dimension = "SERVICE" # attributes the anomaly to a service
}

# The subscription is the part worth owning. AWS attaches a default one to the
# monitor it creates, but that only reports anomalies above 40% *and* $100 of
# expected spend — unreachable on a small account, so it would never fire.
#
# DAILY keeps the subscriber on plain email; IMMEDIATE is SNS-only, and buys
# little because detection itself takes up to a day.
resource "aws_ce_anomaly_subscription" "daily" {
  name             = "cost-anomalies"
  frequency        = "DAILY"
  monitor_arn_list = [aws_ce_anomaly_monitor.services.arn]

  subscriber {
    type    = "EMAIL"
    address = var.alert_email
  }

  threshold_expression {
    dimension {
      key           = "ANOMALY_TOTAL_IMPACT_ABSOLUTE"
      match_options = ["GREATER_THAN_OR_EQUAL"]
      values        = [tostring(var.anomaly_impact_usd)]
    }
  }
}
