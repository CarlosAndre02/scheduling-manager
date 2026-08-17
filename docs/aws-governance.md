# AWS Identity and Account Governance

How access to AWS is meant to be organized for this project, and why. Written for a solo owner whose project may be commercialized, with notes on what changes once a second person is involved.

## The four ways to sign in

| Option                       | What it is                                                                              | Credential                                              | Use it for                                  |
| ---------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------- |
| **Root user**                | Owner of one AWS account, tied to the signup email. Cannot be restricted by any policy. | Permanent password + MFA                                | Only the handful of tasks that require it   |
| **IAM user**                 | Identity **inside a single account**                                                    | Permanent password and/or access keys that never expire | Avoid for humans; legacy only               |
| **IAM Identity Center user** | Identity **above** the accounts, granted access to many of them                         | Temporary, via portal and `aws sso login`               | The default for people                      |
| **Federated identity**       | Umbrella term: temporary credentials obtained from an external provider (SAML/OIDC)     | Temporary                                               | Corporate IdP for people, OIDC for machines |

Two things that commonly trip people up:

- **Identity Center _is_ federation.** It is not a parallel category — it is AWS's managed implementation of it, either with its own directory or backed by Google Workspace / Entra / Okta.
- **Cognito is unrelated.** It authenticates _your product's end users_, not people accessing your AWS account.

### IAM user vs Identity Center user

An Organization contains **accounts**, not people. An IAM user lives inside one account and does not exist outside it. With three accounts you would create the same person three times — three passwords, three MFA registrations, three sets of access keys, and three places to remember during offboarding.

An Identity Center user is created once and granted access to each account through an assignment. One login, one MFA, one place to revoke.

The practical difference shows up immediately in the terminal:

```bash
aws configure      # IAM user: writes a permanent AKIA... key to ~/.aws/credentials
aws sso login      # Identity Center: browser auth, credentials expire in hours
```

Long-lived access keys on a laptop are the most common source of AWS credential leaks — committed by accident, read by a malicious dependency, or taken with the machine.

### Identities are per-organization

The same person can be root of a personal account, an Identity Center user in a company's organization, and an IAM user in some legacy account, all at once. There is no global AWS identity for a human, and the three know nothing about each other.

One constraint: **an email address can be root of only one AWS account.** The same address may still be an Identity Center username elsewhere — different namespaces, no conflict.

## Roles: the underlying mechanism

A **policy** is the permission (`s3:GetObject` on a bucket). A **role** is an identity with no permanent credential, which something else assumes temporarily. Every role has two halves:

- **Trust policy** — _who_ may assume it (an AWS service, an account, an OIDC provider)
- **Permission policies** — _what_ they can do once assumed

Roles serve people and machines alike:

| Case                         | Trusted principal                          | Grants                                  |
| ---------------------------- | ------------------------------------------ | --------------------------------------- |
| EC2 pulling an image         | `ec2.amazonaws.com`                        | ECR read-only, no key stored on the box |
| CI/CD deploying              | GitHub's OIDC provider, scoped to the repo | ECR push, `ssm:SendCommand`             |
| A person entering an account | IAM Identity Center                        | whatever the permission set defines     |

The last row is the point: **Identity Center users hold no permissions of their own — they assume roles.** IAM users and Identity Center users are just different front doors onto the same mechanism.

## Account structure

```
Management account (aws-root@…)      ← administration only, no workloads
├── AWS Organizations
├── IAM Identity Center
├── Account "prod"   (aws-root+prod@…)
└── Account "dev"    (aws-root+dev@…)
```

Separate accounts per environment exist for **blast radius**, not just for pipeline isolation. The account is the strongest boundary AWS offers: a mistake in dev cannot reach prod because they are different accounts, not because a policy says so. Cost separates without tag discipline, quotas do not compete, and compromised dev credentials grant nothing in prod.

Each account needs a **unique root email** — plus-addressing (`aws-root+prod@…`) covers this on most providers.

The management account holds power over the whole organization, so it runs nothing: Organizations, Identity Center, billing and CloudTrail only.

**Nobody writes to prod by hand.** People hold read-only there for debugging; the pipeline deploys through a role; a deliberately named, short-lived permission set exists for emergencies. In dev, people are administrators — that is what dev is for.

## Permission sets

A permission set is a **template**, not a permission. Assigning one to a group on an account makes AWS create a role in that account (`AWSReservedSSO_<name>_<hash>`) whose trust policy only Identity Center can satisfy. Remove the assignment and the role disappears. This is why `aws sts get-caller-identity` reports an assumed role rather than a user.

Access exists in the **assignment**, a triple of (account, principal, permission set):

| Account    | Principal              | Permission set                |
| ---------- | ---------------------- | ----------------------------- |
| dev        | group `Administrators` | `AdministratorAccess`         |
| prod       | group `Administrators` | `ReadOnlyAccess`              |
| prod       | group `Administrators` | `ProdBreakGlass` (1h session) |
| management | group `Administrators` | `Billing`                     |

Assign to **groups**, never directly to users, even with one person — adding the second person then costs one click instead of rebuilding the matrix.

Two independent timers are worth knowing: the permission set's **session duration** (1–12h) governs how long the temporary credentials last, while the Identity Center **sign-in session** governs how long you stay logged into the portal. The first expiring is renewed silently by `aws sso login`; the second expiring asks for password and MFA again.

## Setup

1. **Create the account** with a dedicated email — a company-owned shared mailbox, or a personal address used for nothing else. Requires a real credit card; virtual cards often fail verification.
2. **MFA on root, two devices.** Best pairing is an authenticator app plus a hardware key: independent failure modes. Two TOTP entries in the same password manager is weak redundancy. Store the TOTP seed somewhere separate from the app — losing the phone with no second factor means identity-proofed recovery by phone with AWS.
3. **Store root credentials** (email, password, MFA seeds, the 12-digit account ID) in a password manager, then stop using root.
4. **Enable Organizations** ("All features", not consolidated billing only) **and IAM Identity Center**. Set MFA to _Always-on_ under Settings → Authentication; the default only challenges in suspicious situations.
5. **Create the child accounts.** Member accounts start with no root password — either set one with MFA per account, or use centralized root access management to remove their root credentials entirely.
6. **Create the user, the group, the permission sets, and the assignments**, then work exclusively through the portal.

7. **Turn on the cost guardrails** — see below. Two of the switches are root-only, so they belong in the first root session.

## Daily use

`aws configure sso` writes to `~/.aws/config`:

```ini
[sso-session andre]
sso_start_url = https://andre.awsapps.com/start
sso_region = us-east-1
sso_registration_scopes = sso:account:access

[profile dev]
sso_session = andre
sso_account_id = 222233334444
sso_role_name = AdministratorAccess     # the permission set name
region = sa-east-1
```

The `sso-session` block is shared: one `aws sso login` authenticates every profile pointing at it.

```bash
aws sso login --profile dev
aws sts get-caller-identity --profile dev    # expect assumed-role/AWSReservedSSO_...
AWS_PROFILE=dev terraform plan
```

`region` here is where resources live and is independent of the Identity Center region.

## Cost guardrails

AWS has no spending cap. The bill grows until something is switched off, and the invoice arrives after the month it describes — so an account with no guardrail finds out about a mistake thirty days late.

The implementation is [infra/terraform/billing](../infra/terraform/billing), which carries the runbook; this section is the reasoning behind it.

Two switches gate everything, and only root can flip them, both from the account menu at the top right of the console:

- **Account → IAM user and role access to Billing information → Edit → Activate IAM Access.** Without it, no permission set reaches billing data — the policy grants the action and the account refuses it anyway, which reads as a broken policy and is not one.
- **Billing and Cost Management → Cost Explorer.** Opening it once enables it, and it gates both forecasting and anomaly detection.

Both backfill data over roughly a day, so nothing works the moment they are enabled.

### Two mechanisms

They answer separate questions:

|                            | Catches                             | Fires on                              |
| -------------------------- | ----------------------------------- | ------------------------------------- |
| **Budget**                 | the climb toward a number you chose | absolute spend                        |
| **Cost Anomaly Detection** | a jump that stays under that number | deviation from learned spend patterns |

A budget alone assumes you picked the right ceiling. Anomaly detection needs no number, but needs history — roughly ten days to form a baseline, and up to a day to report.

**`ACTUAL` and `FORECASTED` differ by time, not by certainty.** `ACTUAL` is spend already incurred this month. `FORECASTED` is AWS projecting the month's _total_ from the current run rate, so a `FORECASTED` threshold of $12 fires on day 5 with $2 spent, if the pace projects past $12 by month end. Neither makes cost reversible; the forecast only buys reaction time. That is why warnings use both and any action would use only `ACTUAL` — acting on a projection means shutting things down over a prediction that can be wrong. Forecasting needs roughly five weeks of history, so a `FORECASTED` notification on a new account is inert rather than broken.

**The service monitor is not yours to create.** Enabling Cost Explorer makes AWS create a `SERVICE` anomaly monitor automatically, and an account may hold exactly one — so creating another fails, and the existing one has to be adopted into Terraform instead.

What is worth managing is the **subscription**. The one AWS attaches by default reports only anomalies above 40% _and_ $100 of expected spend, a threshold a small account never reaches, which leaves anomaly detection enabled and permanently silent.

**Budgets measure gross spend, not net.** With a promotional credit applied, net cost reads `$0` and no threshold fires until the credit is exhausted — precisely when a warning would have mattered. Hence `include_credit = false` on every budget.

Budget data refreshes about three times a day, which sets the floor on how fast any of this reacts: a threshold is crossed hours before the email.

### Why nothing shuts down automatically

AWS Budgets can run actions at a threshold, and they are deliberately not used. Budget actions do exactly three things, each aimed at something **named**: attach an IAM policy to listed principals, attach an SCP to an account, or stop listed EC2/RDS instance IDs in one region of the same account.

That falls short of an off switch in ways that matter:

- The lists are literal, not queries. A resource created afterwards is not covered.
- ALB, NAT Gateway, EBS, S3, data transfer and Lambda have no stop action and keep billing regardless.
- Denying IAM permissions blocks _new_ spend from being provisioned; it does nothing about what already runs.
- **A stopped RDS instance restarts by itself after seven days**, so the bill resumes on its own.
- Actions run on the budget refresh, hours after the threshold is crossed.

Netted out, an automated stop takes the service down for paying users, late, incompletely, and temporarily. For software meant to be sold, that failure is worse than the overage it prevents. A billing threshold is a signal to a human, not a control.

### What actually bounds the bill

In descending order of effect:

1. **Credentials that cannot leak.** Nearly every catastrophic AWS bill starts with a long-lived access key in a public repository, followed by GPU instances in every region. OIDC for CI, Identity Center for people, MFA everywhere, and a secret scanner in the pre-commit hook.
2. **Preventive IAM conditions.** `aws:RequestedRegion` and an `ec2:InstanceType` allowlist refuse the API call outright, where a budget only reacts later. As an SCP these cannot be bypassed; as ordinary role policies a compromised admin can strip them — and neither restricts root, which is why root is not a daily driver.
3. **Hard caps in the architecture.** Auto Scaling `max_size`, Lambda reserved concurrency, explicit CloudWatch Logs retention, an RDS storage autoscaling maximum, and avoiding NAT Gateway. These are the only genuinely rigid ceilings.
4. **Detection.** CloudTrail (first management-events trail free) to know what happened, GuardDuty to flag mining and credential use from unusual locations, plus the budgets and anomaly monitor here.

Lowering a service quota is not an option: Service Quotas only accepts values above the current one. WAF is a real defence but is priced per web ACL, per rule and per million requests, which can exceed a hobby-scale monthly budget on its own.

Region choice belongs on this list too. The free tier is region-independent, so within it the region costs nothing either way — but São Paulo (`sa-east-1`) is among the most expensive regions on the platform, running roughly 50–65% above `us-east-1` for equivalent compute, with a wider gap on data transfer out. The trade is latency: roughly 10–30 ms from Brazil to `sa-east-1` against 110–150 ms to `us-east-1`, which matters for interactive workloads and not for an API answering JSON. Confirm current figures in the pricing calculator before committing; the ratio moves by instance family.

### Running only during the hours in use

This is not a contradiction of [why nothing shuts down automatically](#why-nothing-shuts-down-automatically), and the difference is worth stating plainly. That section rejects acting on **spend**, a signal that arrives late and says nothing about whether anyone is using the system. A schedule acts on a **known** fact — that an environment has working hours — and the outage it causes is one that was decided in advance rather than triggered by a threshold.

That also bounds where it applies. An environment switched off nineteen hours a day is unavailable nineteen hours a day, which is sound for development and staging and is an availability decision, not a cost one, the moment someone outside the team can arrive at any hour. Cutting a production bill means running something smaller, or something that scales to zero by design — not turning it off.

**"On-demand" does not mean pay-per-use.** It is AWS's term for "no commitment, billed hourly", and it is the default. An instance accrues charges for every hour it _exists_, running or not. The opposite of on-demand is a Reserved Instance, which is cheaper per hour and bills for the full term regardless — a commitment, not a reduction.

**Stop, never terminate.** Scheduled scaling on an Auto Scaling group is the usual recommendation and it does not stop instances, it replaces them: capacity returns as a _new_ instance with a new volume. Anything the host accumulated is gone every morning, which for a reverse proxy holding Let's Encrypt certificates means a fresh certificate request per day and a broken TLS handshake once the weekly duplicate-certificate limit is reached — see [aws-stack-implementation.md](aws-stack-implementation.md#keeping-compute-disposable). Stopping and starting a specific instance keeps its root volume, which is what makes the pattern survivable.

**EventBridge Scheduler is the mechanism**, and it needs no Lambda: universal targets let a schedule call an AWS SDK action directly, so `ec2:StopInstances` is the target rather than something that invokes it.

```hcl
resource "aws_scheduler_schedule" "stop" {
  schedule_expression          = "cron(0 20 ? * MON-FRI *)"
  schedule_expression_timezone = "America/Sao_Paulo"

  flexible_time_window { mode = "OFF" }

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:ec2:stopInstances"
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ InstanceIds = [<id>] })
  }
}
```

Two reasons to prefer it over the older EventBridge rule plus a Lambda: the schedule carries a **time zone**, so daylight saving does not shift it, where rules are UTC only; and the free tier of 14 million invocations a month means two a day never leaves it. The role it assumes should permit the stop and start actions on that one instance ARN and nothing else. Parameter names in a universal target follow the SDK shape rather than the API reference, so the first execution is the check.

**What still bills while stopped** is the part that disappoints:

|                            | 24/7        | ~5 h on weekdays |
| -------------------------- | ----------- | ---------------- |
| `t4g.small` instance hours | US$12.3     | US$2.5           |
| 20 GB gp3 root volume      | US$1.6      | **US$1.6**       |
| Elastic IP                 | US$3.7      | **US$3.7**       |
| **Total**                  | **US$17.5** | **US$7.8**       |

Storage and address are billed in full, so the saving is around half rather than the four-fifths an hours-only calculation suggests. The Elastic IP is not optional either: without it a stopped instance is assigned a different public address on start, and DNS breaks every morning.

Two operational details: starting takes tens of seconds for EC2 and minutes for RDS, so the first request of the day cannot be the trigger; and **the Instance Scheduler on AWS solution is the wrong tool at this size** — its Lambda, DynamoDB and log costs exceed what scheduling a single instance saves.

### What the guardrails themselves cost

- Budget **monitoring** is free and unlimited. Budget **actions** are what carry a price — the first two action-enabled budgets are free per month, then $0.10 per day each.
- Cost Anomaly Detection is free.
- Email subscribers on a budget are free. An SNS topic would also be free at this volume (1,000 email deliveries and 1M requests per month), but it is only required for `IMMEDIATE` anomaly alerts — `DAILY` and `WEEKLY` take an email address directly, so a topic with one subscriber earns nothing.
- The Cost Explorer **API** charges $0.01 per request. The console and these resources do not use it; a hand-rolled Lambda polling costs would.

## Audit trail

CloudTrail records every call to the AWS API: which identity, which action, when, from which address, with which parameters, and whether it succeeded. The implementation is [infra/terraform/audit](../infra/terraform/audit).

**Logs cannot be created retroactively**, which is the whole argument for enabling it early. Selling software to a company means answering a security questionnaire, and the recurring questions — is administrative access logged, for how long, is the record protected from tampering, can you produce the trail for a given window — are answerable only if the trail was already running. A SOC 2 or ISO 27001 audit samples a period of six to twelve months; "enabled last week" fails it. After a compromise, the same log is what characterizes the incident, and LGPD notification requires characterizing it.

Every account already has **event history**: the last 90 days of management events, free, always on, searchable in the console. A trail is what makes the record outlive that window, span every region in one place, and carry proof of integrity.

**Management events are free; data events are not.** The first copy of management events delivered to S3 costs nothing — only S3 storage is billed, which is pennies for administrative activity. Data events (S3 object access, Lambda invocations) are priced per event and scale with application traffic, so they belong to a decision about observability rather than about audit.

**Governance mode, never compliance mode.** S3 Object Lock is what makes stored logs undeletable, and its compliance mode admits no exception: no principal can delete a locked object before its date, root included, and the only escape is closing the AWS account. Governance mode blocks deletion just as effectively while leaving a permissioned way out. Object Lock also cannot be disabled once enabled, and versioning can no longer be suspended on that bucket.

Two limits worth stating plainly:

- An administrator can still run `StopLogging` or `DeleteTrail`. Object Lock protects what was already written, so the gap is bounded. Closing it entirely means keeping the bucket in a separate account, which requires Organizations.
- CloudTrail logs the AWS API, not the application. It records that a database was modified, never that a user rescheduled a meeting. Application audit logging is a separate concern.

## Things that bite

**Enabling Organizations can move the account off the free plan.** The services themselves cost nothing, but the account's free-tier standing is a separate matter. Where credits matter, confirm the billing consequence before enabling. Account and Billing support is free on every plan, including Basic, and is the right channel when a change was unintentional.

**Closing an account does not reset free-tier eligibility.** It is granted once per customer and assessed by payment method and identity, not by email. A closed account also holds its email for 90 days, and repeated attempts can be treated as abuse.

**The Identity Center region is effectively permanent** — changing it means deleting and recreating the whole configuration.

**The portal subdomain is a one-time choice.**

**Root email choice is irreversible in practice.** Never a personal address for a company account: whoever controls that inbox controls account recovery.

**One browser cannot hold console sessions for several accounts at once.** Use browser profiles or containers. The CLI has no such limitation.
