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

- **ACME certificate storage.** A reverse proxy terminating TLS with Let's Encrypt keeps its certificates in a file. Losing it with the instance means requesting new ones, and the **duplicate certificate limit of five per week** turns the sixth rebuild in a week into an outage lasting until the window rolls. Either the file outlives the instance, or the staging endpoint is used while the infrastructure is being iterated.
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

**Port 80 is open and must serve nothing.** It exists for the redirect to 443 and the ACME HTTP-01 challenge. A plaintext listener that answers anything real is a downgrade path; switching the proxy to the TLS-ALPN-01 challenge closes the port outright.

**Nothing rate limits ahead of the instance.** A reverse proxy's rate limiting runs in the instance's own process, so an attack has already spent its bandwidth and CPU by the time a limit applies. Absorbing traffic before it arrives is what a load balancer with WAF rate rules buys.

**IPv4 rules do not cover IPv6.** Inert while the VPC has no IPv6 block, and not inert the moment one is added: a rule written with `cidr_ipv4` ignores IPv6 traffic entirely, so a subnet given an IPv6 range with unchanged security groups is open in a way the configuration does not show.

**There is no network-level record.** CloudTrail answers what was called on the AWS API, never what connected to what. Flow logs answer the second question and are off for cost, which means an investigation into a suspected intrusion starts with no packet history.

**The emptied default group fails closed, and confusingly.** Anything created without an explicit security group lands in the default one, which now permits nothing. That is the safe direction, but the symptom is a resource that times out rather than one that reports a denial.
