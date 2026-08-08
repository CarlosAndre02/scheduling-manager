# Audit stack

A CloudTrail trail recording every AWS API call in the account, delivered to a tamper-evident S3 bucket. [docs/aws-governance.md](../../../docs/aws-governance.md#audit-trail) explains why it is worth running before anything needs it.

## What it creates

| Resource                            | Effect                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| S3 bucket `cloudtrail-<account-id>` | log destination: versioned, private, SSE-S3, Object Lock in governance mode for `retention_days` |
| Bucket policy                       | lets CloudTrail write, scoped to this trail; denies any non-TLS request                          |
| Lifecycle rules                     | expire log files `retention_days + 30` days after they are written                               |
| CloudTrail trail `account-activity` | multi-region, global service events, log file validation on, management events only              |

**Cost: under $0.10 a month.** The first copy of management events delivered to S3 is free; only S3 storage is billed, and an account this size writes a few megabytes a month. Data events are deliberately excluded — they are priced per event and scale with application traffic.

## Prerequisites

The same local setup as the billing stack: `terraform` and `awscli` on `PATH`, and an IAM user with `AdministratorAccess` configured through `aws configure`. Confirm with `aws sts get-caller-identity`.

Nothing has to be enabled in the console first. CloudTrail's free 90-day event history is already running on every account; this stack is what makes the record outlive it.

## Running

```bash
terraform init
terraform validate
terraform plan
terraform apply
```

Every variable has a default, so `terraform.tfvars` is only needed to override one.

Confirm it is recording:

```bash
aws cloudtrail get-trail-status --name account-activity   # IsLogging: true
aws s3 ls "s3://cloudtrail-$(aws sts get-caller-identity --query Account --output text)/AWSLogs/" --recursive | head
```

The first log files appear within about 15 minutes, and new ones land every 5 or so. An empty bucket immediately after `apply` is expected, not a failure.

## Managing it

**Read the trail.** For anything inside the last 90 days the console's Event history is faster than the bucket. Beyond that, or for a specific principal:

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=ConsoleLogin \
  --start-time 2026-01-01T00:00:00Z --max-results 10
```

**Prove the logs were not altered** — the answer to the tamper-evidence question in a security questionnaire:

```bash
aws cloudtrail validate-logs \
  --trail-arn "$(aws cloudtrail get-trail --name account-activity --query Trail.TrailARN --output text)" \
  --start-time 2026-01-01T00:00:00Z
```

**Change the retention window.** Raising `retention_days` applies to objects written afterwards; log files already locked keep the window they were written under. Lowering it does not unlock anything already stored.

**Tearing it down is deliberately hard.** `terraform destroy` fails while the bucket holds locked objects, which is the point of Object Lock. Removing it means emptying the bucket first, and versions still inside their retention window need the governance bypass:

```bash
aws s3api delete-object --bucket <bucket> --key <key> --version-id <id> \
  --bypass-governance-retention
```

That requires `s3:BypassGovernanceRetention`, which `AdministratorAccess` includes. Consider whether deleting an audit trail is really what you want before reaching for it.

## What it does not cover

CloudTrail records calls to the **AWS API**, not activity inside the application. It will show that an RDS instance was modified; it will never show that a user rescheduled a meeting. Application-level audit logging is a separate concern with a separate implementation.

An administrator can still run `StopLogging` or `DeleteTrail`. Object Lock protects what was already written, so the gap is bounded — but closing it entirely means putting the bucket in a separate account, which requires AWS Organizations.
