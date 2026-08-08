# Billing stack

Cost alerting for the AWS account. It warns; it never switches anything off — [docs/aws-governance.md](../../../docs/aws-governance.md#why-nothing-shuts-down-automatically) explains why that is a decision rather than an omission.

Applied to the **management (payer) account**, where consolidated billing makes every member account's spend roll up.

## What it creates

| Resource                 | Effect                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------- |
| Budget `zero-spend`      | emails on the first cent charged                                                      |
| Budget `monthly-ceiling` | emails at `warning_usd`, at the forecast crossing `warning_usd`, and at `ceiling_usd` |
| Anomaly monitor          | **adopted, not created** — see below                                                  |
| Anomaly subscription     | daily email for anomalies at or above `anomaly_impact_usd`                            |

Everything here is free. Budget monitoring, anomaly detection and email subscribers carry no charge; only budget _actions_, which this stack does not use, are billable.

Thresholds are absolute dollars rather than percentages, so a change to `ceiling_usd` does not silently drag the warning along with it.

## Prerequisites

**In the console, signed in as root** — neither is possible from any other identity, and [docs/aws-governance.md](../../../docs/aws-governance.md#cost-guardrails) has the detail:

1. Account → _IAM user and role access to Billing information_ → Edit → Activate IAM Access
2. Billing and Cost Management → Cost Explorer — opening it once enables it

Both backfill data over roughly a day. `apply` succeeds before they finish; the alerts just have nothing to report yet.

**Locally:**

- An IAM user with `AdministratorAccess` and its access keys in `aws configure`. Never root access keys: a leaked root key has no mitigation, because no policy restricts root.
- `terraform` and `awscli` on `PATH`.

Verify with `aws sts get-caller-identity`.

## Running

```bash
cp terraform.tfvars.example terraform.tfvars   # set alert_email
terraform init
terraform validate
terraform plan
terraform apply
```

The anomaly monitor fails on a fresh account with `Limit exceeded on dimensional spend monitor creation`. This is expected: enabling Cost Explorer makes AWS create a `SERVICE` monitor, and an account may hold exactly one. Adopt it, then apply again:

```bash
aws ce get-anomaly-monitors --query 'AnomalyMonitors[].[MonitorArn,MonitorName]' --output table
terraform import aws_ce_anomaly_monitor.services <arn>
terraform apply
```

`plan` after the import will show one in-place change, renaming the monitor to `all-services`. Accept it, or set `name` in [alerts.tf](alerts.tf) to the existing name.

Confirm the subscription email AWS sends afterwards, and allow `no-reply@budgets.amazonaws.com` before you need it.

## Managing it

**Change a threshold:** edit `terraform.tfvars`, run `plan`, then `apply`. Never add a second `.tf` file describing the new value — Terraform is declarative, so that creates a second budget rather than changing the first. See [docs/terraform.md](../../../docs/terraform.md#it-is-not-a-migration-system).

**Inspect:** `terraform state list`, and `terraform show` for the full state.

**Tear down:** `terraform destroy` removes the budgets, the subscription, and the adopted monitor. Recreating works afterwards because deleting the monitor frees the account's single slot.

State is local and gitignored. Losing it means the resources still exist while Terraform no longer knows about them; the recovery is to delete them in the console and apply again, or to import each one. That is cheap here and would not be for a stack owning a database — [docs/terraform.md](../../../docs/terraform.md#state) covers when a remote backend becomes necessary.
