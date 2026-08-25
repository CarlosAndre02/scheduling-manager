# Compute stack

The host that serves the application: one EC2 instance, a reverse proxy terminating TLS, and the application containers behind it. [docs/vpc.md](../../../docs/vpc.md#the-public-entry-point) is the reasoning behind the entry point; this is the runbook.

## What it creates

| Resource             | Effect                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------- |
| EC2 instance         | `instance_type` in a public subnet, IMDSv2 only, encrypted root volume                  |
| Elastic IP           | a stable address that survives a stop, a start and a replacement                        |
| IAM role and profile | pull one ECR repository, read `/<project>/*` in Parameter Store, accept Session Manager |
| SSM parameters       | `image-tag` and `app-replicas` — what a deploy reads                                    |
| Route 53 A record    | only when `domain_name` is set                                                          |

On the instance: Traefik on 80 and 443, `app_replicas` application containers, and a socket proxy between Traefik and the Docker API.

There is no Auto Scaling group, no load balancer, no ACM certificate and no WAF. Each is a decision with a trigger — see [what it does not cover](#what-it-does-not-cover).

## The two modes

`domain_name` decides which one applies, and nothing else has to change between them.

|             | `domain_name = ""`     | `domain_name` set                   |
| ----------- | ---------------------- | ----------------------------------- |
| Reached at  | `http://<elastic ip>`  | `https://<domain>`                  |
| Certificate | none                   | Let's Encrypt, renewed by the proxy |
| Port 80     | serves the application | redirects to 443, nothing else      |
| Route 53    | no record              | an A record at TTL 60               |

**The empty mode is for bringing the stack up, not for serving anyone.** It proves the instance boots, the image pulls and the database answers, without needing a domain to exist first. Everything it carries crosses the internet in the clear, including whatever the API returns.

Going from one to the other is a variable and an apply. Nothing about the instance changes except the rendered configuration, so it is worth doing in that order rather than blocking the first apply on a domain purchase.

## Prerequisites

`terraform` 1.10 or newer and `awscli`, with credentials carrying `AdministratorAccess`. The [bootstrap](../bootstrap), [network](../network) and [delivery](../delivery) stacks must be applied, and CI must have published at least one image — `image_tag` names a tag that has to exist.

**One value is created by hand, on purpose.** Every attribute of every resource is written to state in plain text, so a database password managed by Terraform sits unencrypted in the state file and in every plan that touches it. The role this stack creates grants read access by path; the value never enters Terraform:

```bash
aws ssm put-parameter \
  --name /scheduling-manager/database-url \
  --type SecureString \
  --value '<the Supavisor session-mode URL, with no sslmode>'
```

Both qualifiers matter and neither fails loudly. Transaction mode breaks the migration advisory lock, and any `sslmode` in the URL makes `pg` discard the certificate authority — [docs/supabase.md](../../../docs/supabase.md).

## Running

```bash
terraform init -backend-config=../backend.hcl
terraform validate
terraform plan
terraform apply
```

`image_tag` has no default. Everything else does — copy `terraform.tfvars.example` only to override one.

The instance takes a minute or two to be useful after `apply` returns: cloud-init still has packages to install and an image to pull.

```bash
# What it is answering
curl -sS "$(terraform output -raw url)/health"

# What the boot actually did, if it is not
aws ssm start-session --target "$(terraform output -raw instance_id)"
sudo tail -100 /var/log/cloud-init-output.log
sudo docker compose -f /opt/app/docker-compose.yaml ps
```

## How a deploy happens

Two steps, and they are separate because they answer different questions.

```bash
terraform apply -var image_tag=<sha>     # declares what should run
eval "$(terraform output -raw deploy_command)"   # makes it run
```

The first moves a Parameter Store value. The second runs `/opt/app/deploy.sh` on the instance through Run Command, which reads that value, logs in to ECR, pulls, and brings the containers up. Nothing opens a port and no key is involved.

**Why the image tag is not in user data.** Cloud-init runs user data once, at first boot, and never again. Anything baked into it can only be delivered by replacing the instance — which here means an outage plus a fresh certificate request against a limit a rebuild loop exhausts quickly. So a release changes a parameter, and the machine stays.

`app_replicas` works the same way, and `deploy.sh` derives each container's `DATABASE_POOL_MAX` from `database_pool_size` divided by the replica count, so raising the replicas cannot quietly ask the pooler for more connections than it has.

**A restart drops no requests, and that is not automatic.** The application answers `503` on `/health` while draining, Traefik health-checks that path every five seconds and takes the draining container out of rotation, and the remaining replicas absorb its traffic. It only works because all three agree on the timing: `stop_grace_period` is longer than the drain, or Docker sends `SIGKILL` in the middle of it and the in-flight requests are cut anyway — with an exit code of 137 as the only trace.

## Managing it

**Editing a template does not change a running instance.** `user_data_replace_on_change` is `false`, so Terraform will not destroy the only host because a comment moved. Delivering a bootstrap change is deliberate:

```bash
terraform apply -replace=aws_instance.app
```

Read what that costs first: the instance is gone for the length of a boot, and the ACME storage goes with it.

**Operating system upgrades are also deliberate.** The AMI comes from an AWS-published parameter that resolves to whatever is newest, and the attribute forces replacement — so `ignore_changes = [ami]` is what stops an unrelated apply months from now from proposing to destroy the host. Upgrading is the same `-replace`, having read what changed.

**Keep `acme_staging = true` until the boot is stable.** Staging certificates are not trusted by browsers; production allows five certificates a week for an identical set of names and refills one every 34 hours, so a rebuild loop leaves the name without a certificate for a day and a half at a time.

**Tuning a limit does not need any of this.** `rate_limit_average`, `rate_limit_burst` and `in_flight_limit` render into `/opt/app/dynamic.yaml`, which Traefik watches and reloads in place — but the file is written by user data, so changing the variable needs the file updated on the instance. Editing it over Session Manager takes effect within seconds and is the right move in an incident; folding the same value back into Terraform afterwards is what keeps the two honest.

**Bumping Compose means bumping its checksum**, on the adjacent line in [instance.tf](instance.tf). That is the point of recording it.

## What it does not cover

**No Auto Scaling group.** A failed instance stays failed until someone looks. What the ASG would have bought is self-healing on the EC2 status check; what it costs is that the Elastic IP association stops being declarative, that scheduled stop/start and self-healing actively conflict, and that a replacement is a fresh certificate request. With no load balancer, raising a desired capacity would not spread traffic anyway — it would produce a second machine that DNS never points at.

**No load balancer, so no cross-instance anything.** No connection draining between hosts, no AZ failover, no ECS. [docs/vpc.md](../../../docs/vpc.md#the-rule-this-project-follows) lists the four properties kept true so one can be introduced additively later.

**No ACM and no WAF, because both attach only to managed entry points.** ACM will not export a private key, so a certificate it issues cannot be installed on an instance you operate; WAF attaches to CloudFront, an ALB or API Gateway and to nothing else. Let's Encrypt replaces the first. Nothing free replaces the second's managed rule sets.

**Rate limiting runs on the instance.** Traffic has already cost bandwidth and CPU by the time a limit rejects it, and the counters live in one process — behind several instances the effective limit would multiply by their number. Absorbing volume before it arrives is what a WAF rate rule in front buys.

**The application container cannot read the instance's credentials, but the host can.** The metadata hop limit is 1, which the Docker bridge exceeds. A compromise of the host is still a compromise of the role.

**Logs stay on the instance.** The Docker daemon caps them at 10 MB per file and three files, so the disk cannot fill; nothing is shipped anywhere, so a replaced instance takes its history with it.

## Security posture

Recorded with the other stacks' in [docs/aws-stack-implementation.md](../../../docs/aws-stack-implementation.md#security-posture).
