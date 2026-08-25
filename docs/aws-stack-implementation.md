# AWS Stack Implementation

How the AWS infrastructure is divided into Terraform stacks, what each one owns, and the order they are applied in. Terraform itself — state, drift, replacement — is in [terraform.md](terraform.md); the network model is in [vpc.md](vpc.md); identity and cost guardrails are in [aws-governance.md](aws-governance.md).

## Why more than one stack

Every stack under `infra/terraform/<stack>/` owns its own state. The cut between them follows two axes that happen to align:

- **Rate of change.** A VPC is created once and edited almost never. Application infrastructure changes whenever the deployment does. Sharing one state means every routine change runs a plan that also evaluates the network and the database.
- **Blast radius.** State is the unit of destruction. `terraform destroy` typed in the wrong directory can only reach what that directory owns, and an apply that goes wrong cannot propose replacing a resource it does not manage.

The consequence to internalize: a single monolithic state makes the most dangerous resources visible to the most frequent operation. Splitting them means the plan for a routine change is short enough to actually read, which is the only review that ever catches anything.

## The stacks

| Stack       | Owns                                                          | Changes | If destroyed                                    |
| ----------- | ------------------------------------------------------------- | ------- | ----------------------------------------------- |
| `bootstrap` | the S3 bucket holding every other stack's state               | never   | every other stack forgets what it created       |
| `network`   | VPC, subnets, route tables, internet gateway, security groups | rarely  | everything running inside it goes down          |
| `delivery`  | ECR repository, GitHub OIDC provider, the CI role             | rarely  | deploys break; what is already running does not |
| `database`  | RDS and its subnet group                                      | rarely  | the data is gone                                |
| `compute`   | EC2, the reverse proxy, DNS records                           | often   | the application goes down                       |

`billing` and `audit` already exist alongside these and follow the same rule: separate concerns, separate state, each with its own runbook.

Workloads live in `us-east-1`. The latency difference from Brazil is 100 ms or so against São Paulo, which does not matter for an API answering JSON, while the cost difference is 50–65% on compute and larger on data transfer — see [aws-governance.md](aws-governance.md).

`delivery` sits apart on purpose. It is the only stack a compromised CI credential can reach, and keeping the database outside that boundary is worth a directory.

**`database` sits apart from `compute` for the same reason the split exists at all.** The instance is meant to be disposable — recreated from an image tag whenever anything changes — and the database is the one thing in the system that cannot be rebuilt from the repository. Sharing a state file would put both in the same plan, so the routine operation of replacing a server would be the operation that can also propose replacing the database. Deletion protection and `prevent_destroy` guard the resource; separate state means the question is never asked.

`network` lays out two public and two private subnets across two AZs regardless of how many are occupied, because empty subnets are free and the resources that demand a second AZ demand it at creation. The reasoning is in [vpc.md](vpc.md).

### What survives a change of runtime

`compute` is the stack expected to be rewritten — from an instance running the image to an ECS service running the same image behind a load balancer. Every other stack survives it:

| Stack      | Under the rewrite                                               |
| ---------- | --------------------------------------------------------------- |
| `network`  | gains one security group for the load balancer; nothing changes |
| `delivery` | untouched — the same repository, the same image, the same role  |
| `database` | untouched — the endpoint the application connects to is a name  |
| `compute`  | replaced                                                        |

The security group rules survive because they name groups rather than addresses, so tasks with ephemeral addresses are already covered by rules written for an instance. The chain gains a link — a group for the load balancer, added in front — and that is an addition to `network` rather than an edit to what it already holds.

The split is what keeps this true. If one stack owned all of it, the plan that introduces the load balancer would also be the plan that can replace the VPC and the database.

### Keeping `compute` disposable

The point of the split is only real if nothing irreplaceable accumulates on the instance. Three things try to:

- **ACME certificate storage.** A reverse proxy terminating TLS with Let's Encrypt keeps its certificates in a file. Losing it with the instance means requesting new ones, and the **duplicate certificate limit — five a week for an identical set of names, refilling one every 34 hours** — turns a rebuild loop into a name with no certificate for a day and a half at a time. Either the file outlives the instance, or the staging endpoint is used while the infrastructure is being iterated.
- **The address.** DNS pointing at an auto-assigned public IP makes every replacement a DNS change with propagation to wait on. An Elastic IP makes it a reassociation, and costs the same, since every public IPv4 address is billed either way.
- **Anything written by hand.** Configuration reaches the instance through environment and parameter store, never through a file edited on the box, or the replacement is not identical and the disposability is imaginary.

## Dependencies between stacks

A stack needs values from another — the compute stack needs subnet IDs and security group IDs. Two mechanisms exist:

| Mechanism                | Couples the consumer to                         |
| ------------------------ | ----------------------------------------------- |
| `terraform_remote_state` | the producer's **state layout** and its backend |
| `data` source lookup     | the producer's **tags**                         |

The data source is preferred. Reading another stack's state means the consumer breaks when the producer renames a resource internally, and it requires read access to a file that may hold secrets. Looking up a VPC by tag makes the tag a deliberate, documented interface — narrower than the whole state, and stable across refactors of the stack that produces it.

The cost is that tags become load-bearing and cannot be renamed casually. That is the correct place for the constraint: an interface should be hard to change by accident.

## Order of application

Each stack is applicable and verifiable on its own, and none depends on a stack that comes after it.

| #   | Stack / step        | Depends on |
| --- | ------------------- | ---------- |
| 1   | `bootstrap`         | —          |
| 2   | `network`           | 1          |
| 3   | `delivery`          | 1          |
| 4   | CI publishes to ECR | 3          |
| 5   | `database`          | 2          |
| 6   | `compute`           | 2, 4, 5    |

The order has a property worth exploiting: **nothing through step 4 costs more than cents.** A state bucket, an empty VPC, an empty ECR repository and an IAM role are effectively free, so the entire delivery pipeline can be built and proven — a real image, built by CI, authenticated by OIDC, landing in a real registry — before anything starts billing by the hour. The always-on resources arrive last, against a pipeline already known to work.

That is also why the spending thresholds in [infra/terraform/billing](../infra/terraform/billing) are raised in the same change that creates step 5, and not before. A budget that alerts on the first cent is a working tripwire for exactly as long as nothing is supposed to be spending — which is steps 1 through 4. Loosening it earlier removes the alarm during the only window it can do its job.

## State backend

[terraform.md](terraform.md) sets three conditions under which local state is defensible: a single operator, nothing sensitive inside, and every resource cheap to recreate by hand. **`network` and `database` break the last two.** State stores every attribute of every resource in plain text, so a database password lands in the file unencrypted, and a VPC with its subnets and routes is not something anyone wants to rebuild from memory.

That is the trigger for a remote backend, and it is about the content of the state rather than the size of the team.

The backend is an S3 bucket with versioning and encryption. Locking prevents two concurrent applies from writing over each other and corrupting the file — historically a DynamoDB table, but **Terraform 1.10 and later lock natively in S3** with `use_lockfile = true`, using conditional writes on a lock object. The DynamoDB table is a resource, a cost and a failure mode that no longer needs to exist; most material published before that still teaches it.

### The bootstrap paradox

The bucket that holds state is itself infrastructure, so the first stack cannot store its state in a backend that does not exist yet. The `bootstrap` stack keeps local state, and that is consistent rather than an exception: it owns a single bucket, holds no secret, and if the file is lost the bucket is adopted back with one `terraform import` — exactly the test that makes local state acceptable.

Every other stack declares the S3 backend from its first apply, so none of them ever holds state locally.

## Security posture

What the implementation defends against and what it does not. Every gap here is a decision with a trigger attached, not an oversight — and the list grows as stacks are added, so it describes what has been decided rather than everything that will need deciding.

### Network exposure

**The instance sits one rule away from the internet.** In a public subnet the security group is the only layer between the workload and the world, where a private subnet would leave it without a routable address even if a rule were wrong. This is the trade in [vpc.md](vpc.md#egress-from-a-private-subnet), taken because a NAT gateway costs more per month than everything else combined.

**Egress is unrestricted.** Any process on the instance can reach any host, which is the path a compromised dependency takes to exfiltrate data or call home. It is open deliberately: the alternative is an allowlist covering ECR, Systems Manager, ACME and package mirrors, which is a moving target maintained by hand. AWS managed prefix lists make it tractable, and the trigger is the instance holding customer data rather than test rows.

**Port 80 is open and must serve nothing.** It exists for the redirect to 443. A plaintext listener that answers anything real is a downgrade path, and the `TLS-ALPN-01` challenge keeps the ACME exchange on 443 so the port has no second job — closing it outright costs only the convenience of anyone who typed `http://`.

**Nothing rate limits ahead of the instance.** A reverse proxy's rate limiting runs in the instance's own process, so an attack has already spent its bandwidth and CPU by the time a limit applies. Absorbing traffic before it arrives is what a load balancer with WAF rate rules buys.

**IPv4 rules do not cover IPv6.** Inert while the VPC has no IPv6 block, and not inert the moment one is added: a rule written with `cidr_ipv4` ignores IPv6 traffic entirely, so a subnet given an IPv6 range with unchanged security groups is open in a way the configuration does not show.

**There is no network-level record.** CloudTrail answers what was called on the AWS API, never what connected to what. Flow logs answer the second question and are off for cost, which means an investigation into a suspected intrusion starts with no packet history.

**The emptied default group fails closed, and confusingly.** Anything created without an explicit security group lands in the default one, which now permits nothing. That is the safe direction, but the symptom is a resource that times out rather than one that reports a denial.

### The application host

**Nothing patches the operating system.** Amazon Linux locks its repositories to the version of the image the instance launched from, so `dnf update` pulls nothing newer without being told a release version, and `ignore_changes = [ami]` stops Terraform rolling the image forward. The package set is therefore frozen at launch and stays frozen. Two things close it: Patch Manager applying updates in place on a schedule, or replacing the instance onto a current image periodically. Neither happens by itself, and the symptom of neither happening is silence.

**The host's role is the database credential.** The metadata hop limit of 1 keeps containers away from the instance's credentials, which is what stops a compromised application from reading them. It does nothing for the host: any code execution outside a container inherits a role that can read the project's parameters. The boundary is the container, not the machine.

**The credential rests on disk and in every replica's environment.** It is written mode 600 and owned by root, which stops another user reading the file — and `docker inspect` still prints the environment to anyone in the docker group, as does `/proc/<pid>/environ` to root. Docker has no secret mount outside Swarm, so this is the floor rather than a shortcut past a better option.

**A container escape from the proxy lands as root on the host.** The socket proxy closes the easy path, and the hard path is untouched: containers run with the default capability set, a writable root filesystem, no `no-new-privileges`, and no user-namespace remapping — and the proxy's own process runs as root inside its container because it binds privileged ports. Dropping capabilities and mounting the root filesystem read-only are cheap; they are absent, not ruled out.

**Infrastructure images are pinned by tag, not by digest.** The workflow pins its actions by commit SHA precisely because a tag can be repointed by whoever owns it, and the same argument applies here with more force — one of these images belongs to a third party and runs adjacent to the Docker socket. The Compose binary is pinned by checksum and is the shape the others should take.

**Plaintext is a supported mode, not an error state.** Bringing the stack up without a hostname produces a working endpoint with no transport security at all, and nothing distinguishes it from a finished one except reading the URL. What makes it safe is that it is temporary; nothing enforces that.

**The TLS floor is a default nobody declared.** No options block sets a minimum protocol version or a cipher list, so the floor is whatever the proxy ships with — which is a reasonable value and a moving one, changing when the proxy is upgraded rather than when anyone decides.

**Rate limiting keys on an identifier the caller chooses.** Per-address limits are bypassed by spreading the source and are shared by everyone behind one NAT. On a burstable instance the consequence is not only slowness: absorbed traffic above the baseline is billed as surplus CPU, so a flood converts into an invoice even when it is served successfully. A spending alarm is the detection, which makes it the wrong instrument arriving late.

**An investigation would start with almost nothing.** The access log keeps 4xx and 5xx, so data taken through requests that returned 200 leaves no record; container logs are capped and never shipped, so a replaced instance takes its history with it. This is the right trade for a disk and the wrong one for an incident, and the trigger for reversing it is the first real customer record entering the database.

**A deploy is remote code execution gated only by IAM.** Run Command executes the deploy script as root, and the parameter that names the image decides what runs. Anyone holding both permissions can put any image CI ever published onto the host, without a review step or an approval. The bound is what is in that one repository; there is no second one.
