# Compute stack

The host that serves the application: one EC2 instance, a reverse proxy terminating TLS, and the application containers behind it. [docs/vpc.md](../../../docs/vpc.md#the-public-entry-point) is the reasoning behind the entry point; this is the runbook.

## What it creates

| Resource             | Effect                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------- |
| EC2 instance         | `instance_type` in a public subnet, IMDSv2 only, encrypted root volume                  |
| Elastic IP           | a stable address that survives a stop, a start and a replacement                        |
| IAM role and profile | pull one ECR repository, read `/<project>/*` in Parameter Store, accept Session Manager |
| SSM parameters       | `image-tag` and `app-replicas` — what a deploy reads                                    |
| SSM document         | the only command the CI role may run on the instance, and it takes no arguments         |
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

Starting without a domain is worth doing rather than blocking the first apply on a domain purchase — but **switching afterwards is not just a variable and an apply.**

Setting `domain_name` re-renders the proxy's configuration and the Compose file, adding the `443` publish, the certificate resolver and the TLS labels. Those files are delivered by user data, and cloud-init runs once. The apply creates the DNS record and changes nothing on the host, so the name resolves to an instance still listening on `80` alone and HTTPS is refused — which reads like a certificate problem and is a delivery problem.

The switch therefore needs the instance rebuilt:

```bash
terraform apply -var domain_name=api.example.com -var acme_email=you@example.com
terraform apply -replace=aws_instance.app
```

Keep `acme_staging = true` across that first rebuild. Confirm a certificate is issued at all before asking a rate-limited authority for a trusted one.

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

`image_tag` has no default, because the first boot pulls whatever it names. Everything else does — copy `terraform.tfvars.example` only to override one.

The instance takes a minute or two to be useful after `apply` returns: cloud-init still has packages to install and an image to pull.

```bash
# What it is answering
curl -sS "$(terraform output -raw url)/health"

# What the boot actually did, if it is not
aws ssm start-session --target "$(terraform output -raw instance_id)"
sudo tail -100 /var/log/cloud-init-output.log
sudo docker compose -f /opt/app/docker-compose.yaml ps
```

### What to check, and what each check proves

The checks worth running after an apply are the ones the local exercise in [ec2.md](../../../docs/ec2.md#testing-it-before-it-is-real) structurally cannot reach. Repeating the rest proves nothing: it exercises the same rendered files.

| Check                                                   | Proves                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------ |
| `curl <elastic ip>/health`                              | the address association, routing, and container discovery    |
| `curl <elastic ip>/users/$(uuidgen)` → **404, not 500** | the database round-trip **from the instance**                |
| `docker compose ps`                                     | every replica running and `healthy`                          |
| a few 404s, then the proxy log filtered on `:4000`      | requests reaching more than one replica                      |
| `docker stop` one replica, under traffic                | the drain, the health check and the grace period still agree |
| `scripts/release.sh <the tag already running>`          | the whole release path, without changing what is running     |

**The second one is the point.** `/health` deliberately does not touch the database, so a healthy instance proves the container started and nothing more. A well-formed but nonexistent id makes the query run without writing anything: `404` means the connection, the TLS configuration and the bundled certificate authority all work over the instance's network path, which is not the one CI used.

**The last one needs its result read before anything else touches the container:**

```bash
sudo docker inspect -f 'exit={{.State.ExitCode}}' <container>
sudo docker logs <container> 2>&1 | tail -4
```

`exit=0` with `Shutdown complete` is the pass. `exit=137` is `SIGKILL` arriving mid-drain, which means `stop_grace_period` no longer covers the drain plus the shutdown timeout.

**Then put the replica back.** `docker stop` marks a container as stopped _by hand_, and `restart: unless-stopped` honours that — so it will not return on its own, and the host is left running on one replica, which is the state two replicas exist to avoid:

```bash
sudo docker compose -f /opt/app/docker-compose.yaml up -d
```

That command is also the cheapest demonstration that a deploy is idempotent: it starts what is missing and reports the rest as already running.

**Releasing the tag that is already released proves the path, not the payload.** Nothing changes on the host — the pull is a no-op and the containers are already healthy — while the run still exercises the ECR lookup, the parameter write, the document, the instance's own permissions and the health gate. It is the only way to find out that a release is broken at a moment when nothing depends on it working.

## How a deploy happens

Not through Terraform.

```bash
scripts/release.sh --list     # what ECR holds, and what is released now
scripts/release.sh <sha>      # deploy, or roll back
```

The script moves `/<project>/image-tag`, sends the `<project>-deploy` document through Run Command, and waits for a verdict. On the instance, `/opt/app/deploy.sh` reads the parameter, logs in to ECR, pulls, brings the containers up, and refuses to report success until as many containers are healthy as there are replicas. Nothing opens a port and no key is involved. [docs/ci-cd.md](../../../docs/ci-cd.md#deploying) covers the order and why each step is where it is.

**`image_tag` is a seed, not a lever.** Terraform creates the parameter with it and then stops owning the value (`ignore_changes`), because a release and an apply writing to the same place means the apply eventually reverts a release it knows nothing about. Editing the variable after the first apply plans nothing.

**Why the tag is not in user data at all.** Cloud-init runs user data once, at first boot, and never again. Anything baked into it can only be delivered by replacing the instance — which here means an outage plus a fresh certificate request against a limit a rebuild loop exhausts quickly. So a release changes a parameter, and the machine stays.

**A failed deploy is not rolled back for you.** `deploy.sh` exits non-zero and leaves the failed release in place, because reverting from there would be guessing at a cause it cannot see — an unreachable database fails every image's health check equally, and the host would flip between two good releases while the real fault goes unreported. The way back is `scripts/release.sh <previous-sha>`, and the failure message names it — [docs/rollback.md](../../../docs/rollback.md) covers what it does and does not reverse.

`app_replicas` works the same way, and `deploy.sh` derives each container's `DATABASE_POOL_MAX` from `database_pool_size` divided by the replica count, so raising the replicas cannot quietly ask the pooler for more connections than it has.

**Two files, and they are not interchangeable.** `deploy.sh` writes both into `/opt/app`, and confusing them puts a credential where it does not belong:

| File      | Read by                                          | Holds                                     | Reaches the container           |
| --------- | ------------------------------------------------ | ----------------------------------------- | ------------------------------- |
| `app.env` | Compose, through `env_file:`                     | `DATABASE_URL`                            | yes, as environment             |
| `.env`    | Compose, to substitute `${}` in the Compose file | image reference, replica count, pool size | only if named in `environment:` |

`.env` is textual substitution across the whole Compose file, and `docker compose config` prints the result — which is why the credential is not in it.

**A restart drops no requests, and that is not automatic.** The application answers `503` on `/health` while draining, Traefik health-checks that path every five seconds and takes the draining container out of rotation, and the remaining replicas absorb its traffic. It only works because all three agree on the timing: `stop_grace_period` is longer than the drain, or Docker sends `SIGKILL` in the middle of it and the in-flight requests are cut anyway — with an exit code of 137 as the only trace.

## Managing it

Every change goes through `plan` and `apply`; nothing here is edited in the console, and anything that is will be reverted by the next apply. What differs is the cost of each change, and the plan is the authority — this table is the expectation to check it against.

| Changing                                         | Costs                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| `app_replicas`                                   | a parameter; needs a deploy to take effect                                  |
| `image_tag`, after the first apply               | nothing — the value belongs to `scripts/release.sh`                         |
| `instance_type` (within Graviton)                | a stop, a resize and a start — the instance survives                        |
| `root_volume_size`, upward                       | grown in place                                                              |
| security groups, `metadata_options`              | in place                                                                    |
| the templates, `rate_limit_*`, `in_flight_limit` | nothing, until the instance is rebuilt — see below                          |
| `domain_name`                                    | a DNS record, and nothing on the host — see [the two modes](#the-two-modes) |
| `subnet_id`                                      | **replaces the instance**                                                   |

**Editing a template does not change a running instance.** `user_data_replace_on_change` is `false`, so Terraform will not destroy the only host because a comment moved. Delivering a bootstrap change is deliberate:

```bash
terraform apply -replace=aws_instance.app
```

Read what that costs first: the instance is gone for the length of a boot, and the ACME storage goes with it.

**`deploy.sh` is one of those templates.** It is written by user data, so a change to it — the health gate, the pool arithmetic — reaches a running host only through a rebuild. When a rebuild is not wanted, the rendered script can be placed on the instance directly over Session Manager, which is a change Terraform cannot see and has to be folded back by rebuilding eventually:

```bash
aws ssm start-session --target <instance-id>
sudo tee /opt/app/deploy.sh < <the rendered script> && sudo chmod 0750 /opt/app/deploy.sh
```

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
