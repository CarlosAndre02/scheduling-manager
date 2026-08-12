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
| `compute`   | RDS, EC2, the reverse proxy, DNS records                      | often   | the application goes down                       |

`billing` and `audit` already exist alongside these and follow the same rule: separate concerns, separate state, each with its own runbook.

`delivery` sits apart from `compute` on purpose. It is the only stack a compromised CI credential can reach, and keeping the database out of that boundary is worth a directory.

`network` lays out two public and two private subnets across two AZs regardless of how many are occupied, because empty subnets are free and the resources that demand a second AZ demand it at creation. The reasoning is in [vpc.md](vpc.md).

### What survives a change of runtime

`compute` is the stack expected to be rewritten — from an instance running the image to an ECS service running the same image behind a load balancer. The split is drawn so that this rewrite stays contained:

| Stays as it is                            | Is replaced       |
| ----------------------------------------- | ----------------- |
| VPC, subnets, route tables                | the instance      |
| the existing security group rules         | the reverse proxy |
| ECR repository and image tags             |                   |
| the OIDC provider and the CI role's trust |                   |
| RDS and its subnet group                  |                   |

The security group rules survive because they name groups rather than addresses, so tasks with ephemeral addresses are already covered by rules written for an instance. The chain does gain a link — a group for the load balancer, added in front — and that is an addition to `network` rather than an edit to what it already holds.

Splitting the runtime away from the network is what keeps that true. If one stack owned both, the plan that introduces the load balancer would also be the plan that can replace the VPC.

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
| 5   | `compute`           | 2, 4       |

The order has a property worth exploiting: **nothing before step 5 costs more than cents.** A state bucket, an empty ECR repository and an IAM role are effectively free, so the entire delivery pipeline can be built and proven — a real image, built by CI, authenticated by OIDC, landing in a real registry — before anything starts billing by the hour. The expensive, always-on resources arrive last, against a pipeline already known to work.

## State backend

[terraform.md](terraform.md) sets three conditions under which local state is defensible: a single operator, nothing sensitive inside, and every resource cheap to recreate by hand. **The `network` and `compute` stacks break the last two.** State stores every attribute of every resource in plain text, so a database password lands in the file unencrypted, and a VPC with its subnets and routes is not something anyone wants to rebuild from memory.

That is the trigger for a remote backend, and it is about the content of the state rather than the size of the team.

The backend is an S3 bucket with versioning and encryption. Locking prevents two concurrent applies from writing over each other and corrupting the file — historically a DynamoDB table, but **Terraform 1.10 and later lock natively in S3** with `use_lockfile = true`, using conditional writes on a lock object. The DynamoDB table is a resource, a cost and a failure mode that no longer needs to exist; most material published before that still teaches it.

### The bootstrap paradox

The bucket that holds state is itself infrastructure, so the first stack cannot store its state in a backend that does not exist yet. The `bootstrap` stack keeps local state, and that is consistent rather than an exception: it owns a single bucket, holds no secret, and if the file is lost the bucket is adopted back with one `terraform import` — exactly the test that makes local state acceptable.

Every other stack declares the S3 backend from its first apply, so none of them ever holds state locally.
