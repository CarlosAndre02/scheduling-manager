# One page answering "is it up, is it fast, is it about to cost money".
#
# Declared here rather than drawn in the console, for the same reason every
# other resource is: a dashboard built by hand is lost with the account and
# describes nothing anyone can review. The first few per account are free.

locals {
  # The grid is 24 columns wide. Widths below are chosen so each row fills it.
  dashboard_widgets = [
    {
      type   = "metric"
      x      = 0
      y      = 0
      width  = 12
      height = 6
      properties = {
        title  = "Latency — p95 and p99"
        region = var.region
        view   = "timeSeries"
        stat   = "p95"
        period = 300
        yAxis  = { left = { label = "ms", showUnits = false } }
        metrics = [
          [var.project, "RequestDuration", { stat = "p95", label = "p95" }],
          [".", ".", { stat = "p99", label = "p99" }],
          [".", ".", { stat = "Average", label = "average" }],
        ]
        annotations = {
          horizontal = [{ label = "alarm", value = var.latency_alarm_ms }]
        }
      }
    },
    {
      # SampleCount on the duration metric, which is the request count without
      # a second metric being published for it.
      type   = "metric"
      x      = 12
      y      = 0
      width  = 12
      height = 6
      properties = {
        title  = "Throughput and server errors"
        region = var.region
        view   = "timeSeries"
        period = 300
        metrics = [
          [var.project, "RequestDuration", { stat = "SampleCount", label = "requests" }],
          [var.project, "ServerErrors", { stat = "Sum", label = "5xx", color = "#d62728" }],
        ]
      }
    },
    {
      type   = "metric"
      x      = 0
      y      = 6
      width  = 8
      height = 6
      properties = {
        title  = "Readiness failures — the database, not the process"
        region = var.region
        view   = "timeSeries"
        period = 300
        metrics = [
          [var.project, "ReadinessFailures", { stat = "Sum", label = "failed probes" }],
        ]
      }
    },
    {
      # Where a burstable instance stops being cheap: in unlimited mode the
      # surplus is billed rather than throttled.
      type   = "metric"
      x      = 8
      y      = 6
      width  = 8
      height = 6
      properties = {
        title  = "CPU credits — balance, and the surplus that is billed"
        region = var.region
        view   = "timeSeries"
        period = 300
        metrics = [
          ["AWS/EC2", "CPUCreditBalance", "InstanceId", aws_instance.app.id, { stat = "Average", label = "balance" }],
          [".", "CPUSurplusCreditsCharged", ".", ".", { stat = "Sum", label = "billed surplus", color = "#d62728" }],
        ]
      }
    },
    {
      type   = "metric"
      x      = 16
      y      = 6
      width  = 8
      height = 6
      properties = {
        title  = "Disk and memory"
        region = var.region
        view   = "timeSeries"
        period = 300
        yAxis  = { left = { min = 0, max = 100, label = "%", showUnits = false } }
        metrics = [
          [var.project, "disk_used_percent", "InstanceId", aws_instance.app.id, { stat = "Maximum", label = "disk" }],
          [var.project, "mem_used_percent", "InstanceId", aws_instance.app.id, { stat = "Average", label = "memory" }],
        ]
        annotations = {
          horizontal = [{ label = "disk alarm", value = var.disk_alarm_percent }]
        }
      }
    },
    {
      # The per-route detail deliberately not paid for as metrics: publishing
      # duration dimensioned by route would be one metric per route, while
      # computing it on demand costs a fraction of a cent per GB scanned.
      type   = "log"
      x      = 0
      y      = 12
      width  = 12
      height = 6
      properties = {
        title  = "Slowest routes — computed from the logs, not published as metrics"
        region = var.region
        view   = "table"
        query  = "SOURCE '${aws_cloudwatch_log_group.app.name}' | filter ispresent(duration_ms) | stats count(*) as requests, pct(duration_ms, 95) as p95_ms by `req.method`, `req.url` | sort p95_ms desc | limit 20"
      }
    },
    {
      type   = "log"
      x      = 12
      y      = 12
      width  = 12
      height = 6
      properties = {
        title  = "Recent failures — request id, error id and the message"
        region = var.region
        view   = "table"
        query  = "SOURCE '${aws_cloudwatch_log_group.app.name}' | filter level = 'error' | fields @timestamp, requestId, error_id, msg, `err.type` | sort @timestamp desc | limit 20"
      }
    },
  ]
}

resource "aws_cloudwatch_dashboard" "app" {
  dashboard_name = var.project
  dashboard_body = jsonencode({ widgets = local.dashboard_widgets })
}
