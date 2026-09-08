# What wakes someone up.
#
# Every alarm here is a symptom a user would feel. High CPU is not one; a slow
# request is. An alarm that fires without a consequence teaches people to ignore
# the next one, which is the same reason the pipeline's gates are set where they
# are — docs/ci-cd.md.

resource "aws_sns_topic" "alarms" {
  name = "${var.project}-alarms"
}

# Email needs confirming: AWS sends a link and the subscription stays
# PendingConfirmation until it is clicked. An unconfirmed subscription is a
# silent one, and nothing about the alarm reports that.
resource "aws_sns_topic_subscription" "alarms_email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ── metrics extracted from the log the application already writes ─────────────
#
# Reading a number out of a structured log costs one metric; publishing the same
# number dimensioned by route and status would cost one per combination, which
# on nine routes is more than the instance being watched. Per-route detail comes
# from queries over the same logs instead — docs/observability-and-monitoring.md.

resource "aws_cloudwatch_log_metric_filter" "server_errors" {
  name           = "${var.project}-server-errors"
  log_group_name = aws_cloudwatch_log_group.app.name
  pattern        = "{ $.res.status >= 500 }"

  metric_transformation {
    name      = "ServerErrors"
    namespace = var.project
    value     = "1"

    # Without this the metric has no datapoint when nothing fails, and an alarm
    # over it sits in INSUFFICIENT_DATA forever rather than reporting health.
    default_value = 0
  }
}

resource "aws_cloudwatch_log_metric_filter" "request_duration" {
  name           = "${var.project}-request-duration"
  log_group_name = aws_cloudwatch_log_group.app.name
  pattern        = "{ $.duration_ms = * }"

  metric_transformation {
    name      = "RequestDuration"
    namespace = var.project
    value     = "$.duration_ms"
    unit      = "Milliseconds"
  }
}

# The readiness probe reports an unreachable database on every poll, so this
# counts polls rather than incidents — the threshold below is what turns a blip
# into an alarm.
resource "aws_cloudwatch_log_metric_filter" "readiness_failures" {
  name           = "${var.project}-readiness-failures"
  log_group_name = aws_cloudwatch_log_group.app.name
  pattern        = "{ $.msg = \"database probe failed\" }"

  metric_transformation {
    name          = "ReadinessFailures"
    namespace     = var.project
    value         = "1"
    default_value = 0
  }
}

# ── the alarms ────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "server_errors" {
  alarm_name          = "${var.project}-5xx"
  alarm_description   = "Requests are failing. The symptom, not the cause — start from the request ids in the log."
  namespace           = var.project
  metric_name         = "ServerErrors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = var.error_alarm_count
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "latency" {
  alarm_name          = "${var.project}-latency-p95"
  alarm_description   = "Requests are slow. The symptom a 5xx rate misses, because a timeout the caller gives up on never becomes a status code here."
  namespace           = var.project
  metric_name         = "RequestDuration"
  extended_statistic  = "p95"
  period              = 300
  evaluation_periods  = 2
  threshold           = var.latency_alarm_ms
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "readiness" {
  alarm_name          = "${var.project}-not-ready"
  alarm_description   = "The application cannot reach its database. Liveness stays green throughout, which is why this alarm exists separately."
  namespace           = var.project
  metric_name         = "ReadinessFailures"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

# A burstable instance in `unlimited` mode bills surplus CPU instead of
# throttling, so sustained load converts into an invoice rather than into
# slowness. The spending alarm reports that after the money is gone.
#
# The metric is the surplus *charged*, not the credit balance. Balance looked
# like the obvious choice and is unusable: an instance is created with zero
# credits and accrues them over hours, so any threshold meaningful for a drain
# is breached by every replacement — an alarm that fires on a routine operation
# and stays on is one that trains people to ignore the set it belongs to.
#
# Charged surplus is zero until the instance actually exceeds its baseline on
# borrowed capacity, which is the event worth an email.
resource "aws_cloudwatch_metric_alarm" "cpu_surplus" {
  alarm_name          = "${var.project}-cpu-surplus-billed"
  alarm_description   = "The instance is running above its baseline on surplus credits, which unlimited mode bills rather than throttles. A cost alarm wearing a performance costume."
  namespace           = "AWS/EC2"
  metric_name         = "CPUSurplusCreditsCharged"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]

  dimensions = {
    InstanceId = aws_instance.app.id
  }
}

# Released images accumulate: immutable tags mean pulling a new one never
# orphans the previous one, so nothing is ever dangling and the prune reclaims
# nothing. That is what makes a rollback instant and what fills the disk.
resource "aws_cloudwatch_metric_alarm" "disk" {
  alarm_name          = "${var.project}-disk-filling"
  alarm_description   = "The root volume is filling. Most likely released images — see docs/rollback.md before reclaiming, since the images are the rollback window."
  namespace           = var.project
  metric_name         = "disk_used_percent"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = var.disk_alarm_percent
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alarms.arn]

  dimensions = {
    InstanceId = aws_instance.app.id
  }
}

# Nothing else notices the host dying. There is no Auto Scaling group, so a
# failed instance stays failed until someone looks — this is what makes someone
# look. The metric combines the instance check, which sees a wedged operating
# system, with the system check, which sees the hardware under it.
#
# `missing` rather than `breaching`: a deliberate stop also stops the metric,
# and an alarm that cannot tell a stop from a death would cry wolf every time
# the instance is paused on purpose.
resource "aws_cloudwatch_metric_alarm" "instance_health" {
  alarm_name          = "${var.project}-instance-unhealthy"
  alarm_description   = "The instance failed an EC2 status check. With no Auto Scaling group behind it, recovery is manual."
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]

  dimensions = {
    InstanceId = aws_instance.app.id
  }
}

# Silence is a symptom the error alarm cannot report: zero requests are zero
# errors. A collapse to nothing is DNS, a security group, or a proxy routing
# into the void — all of which leave the application healthy and unreachable.
#
# The count comes free from the duration metric: a filter that extracts a value
# publishes SampleCount alongside it, so this costs no metric of its own.
#
# Off until the number is meaningful. An API whose only callers are its own
# probes — and probes are excluded from request logging on purpose — has no
# traffic to lose, and an alarm that fires every night is one nobody reads.
resource "aws_cloudwatch_metric_alarm" "traffic" {
  count = var.traffic_alarm_min_requests > 0 ? 1 : 0

  alarm_name          = "${var.project}-no-traffic"
  alarm_description   = "Requests stopped arriving. The application can be perfectly healthy and unreachable."
  namespace           = var.project
  metric_name         = "RequestDuration"
  statistic           = "SampleCount"
  period              = 300
  evaluation_periods  = 2
  threshold           = var.traffic_alarm_min_requests
  comparison_operator = "LessThanThreshold"

  # No datapoint at all is the condition being detected, not an absence of
  # information — the one alarm here where missing data means breaching.
  treat_missing_data = "breaching"
  alarm_actions      = [aws_sns_topic.alarms.arn]
  ok_actions         = [aws_sns_topic.alarms.arn]
}
