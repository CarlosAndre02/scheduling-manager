# Network stack

The VPC everything else runs inside: subnets across two availability zones, a route out for the public ones, and the security group chain. [docs/vpc.md](../../../docs/vpc.md) is the model behind every decision here; this is the runbook.

## What it creates

| Resource               | Count | Effect                                                                    |
| ---------------------- | ----- | ------------------------------------------------------------------------- |
| VPC                    | 1     | `vpc_cidr`, with DNS support and DNS hostnames both on                    |
| Public subnets         | 2     | one per AZ, default route to the internet gateway, no automatic public IP |
| Private subnets        | 2     | one per AZ, no default route at all                                       |
| Internet gateway       | 1     | free, no bandwidth limit                                                  |
| Route tables           | 2     | public with the default route, private deliberately without one           |
| S3 gateway endpoint    | 1     | free; keeps S3 and ECR layer traffic off the internet gateway             |
| Security groups        | 2     | `app` and `db`, chained by reference                                      |
| Default security group | 1     | adopted and emptied                                                       |

**Cost: nothing.** Not one resource here is billable, which is why the stack can be applied and left standing long before any compute exists. The first charge in this project arrives with the database.

There is no NAT gateway, no interface endpoint and no flow log. Each omission is a decision with a trigger for revisiting it — see [what it does not cover](#what-it-does-not-cover).

## The chain

```
internet ──443/80──▶ [app] ──5432──▶ [db]
                              source: app
```

Two links, not three: a security group attaches to a network interface, and the reverse proxy shares a host with the application, so there is no boundary between them to describe. The database's rule names the application's **group**, never an address, so replacing the instance is already covered.

A third link appears in front when the proxy moves onto a load balancer. One rule changes — the ingress on `app` swaps `0.0.0.0/0` for the load balancer's group — and nothing else in the stack moves.

## Prerequisites

The same local setup as the other stacks: `terraform` 1.10 or newer and `awscli` on `PATH`, with credentials carrying `AdministratorAccess`. Confirm with `aws sts get-caller-identity`.

The [bootstrap](../bootstrap) stack has to be applied first, since its bucket is where this stack's state lives.

## Running

```bash
terraform init -backend-config=../backend.hcl
terraform validate
terraform plan
terraform apply
```

Every variable has a default, so `terraform.tfvars` is only needed to override one.

Confirm the result:

```bash
# Four subnets, two AZs, and the Tier tag other stacks select on
aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$(terraform output -raw vpc_id)" \
  --query 'Subnets[].[Tags[?Key==`Tier`]|[0].Value,AvailabilityZone,CidrBlock]' \
  --output table

# Route targets per table. The public one carries an igw-…; the private one
# carries local and the S3 endpoint's vpce-… and no igw-…, which is what having
# no way out looks like. join() flattens the list — a nested one cannot be
# rendered as a table, and asking for it fails with "Row should have 1 elements".
aws ec2 describe-route-tables \
  --filters "Name=vpc-id,Values=$(terraform output -raw vpc_id)" \
  --query 'RouteTables[].{Name:Tags[?Key==`Name`]|[0].Value,Targets:join(`, `,Routes[].GatewayId)}' \
  --output table

# The default group is empty — both lists should read []
aws ec2 describe-security-groups \
  --filters "Name=vpc-id,Values=$(terraform output -raw vpc_id)" "Name=group-name,Values=default" \
  --query 'SecurityGroups[0].[IpPermissions,IpPermissionsEgress]' \
  --output json
```

A third route table appears with no name: the main table AWS creates alongside the VPC, carrying only the local route. It is harmless because all four subnets are associated with a table of their own, so nothing falls back to it — it would only matter for a subnet created later without an association.

## How other stacks find it

They do not read this stack's state. They look the network up by tag, which keeps the coupling to a documented interface rather than to an internal layout:

```hcl
data "aws_vpc" "main" {
  filter {
    name   = "tag:Name"
    values = ["${var.project}-vpc"]
  }
}

data "aws_subnets" "private" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.main.id]
  }
  filter {
    name   = "tag:Tier"
    values = ["private"]
  }
}
```

`Tier` exists separately from `Name` for exactly this: the consumer selects by role, without depending on how the subnets were named. **Both tags are load-bearing and cannot be renamed casually** — see [docs/aws-stack-implementation.md](../../../docs/aws-stack-implementation.md#dependencies-between-stacks).

## Managing it

**Changing `vpc_cidr` rebuilds everything.** The CIDR is fixed at creation, so the plan is a destroy and create of the VPC and every subnet in it. Read the plan in full before accepting one that touches it.

**Changing a subnet's availability zone destroys and recreates the subnet**, taking whatever is inside with it. The AZ list comes from `data.aws_availability_zones`, which is sorted and stable in practice, but this is not somewhere to make a casual edit.

**Adding a subnet** means extending the `count` and the CIDR list in [vpc.tf](vpc.tf). The `+ 10` offset on the private block exists so a third public subnet can be added without renumbering the private ones.

**Opening a port** is a new `aws_vpc_security_group_ingress_rule`, never an inline block on the group — the two forms cannot coexist on one group without producing a permanent diff. Rule descriptions accept only `a-zA-Z0-9. _-:/()#,@[]+=&;{}!$*`, so an apostrophe fails at apply and not at `validate`, which never calls the API.

**Tearing it down** fails while anything still runs inside the VPC, which is the useful behaviour: destroy the `compute` and `database` stacks first. The adopted default security group is a special case — Terraform drops it from state rather than deleting it, because AWS does not allow deleting it at all.

## Security posture

What this layout defends against and what it does not. Every gap below is a decision with a trigger attached, not an oversight.

**The instance sits one rule away from the internet.** In a public subnet the security group is the only layer between the workload and the world, where a private subnet would leave it without a routable address even if a rule were wrong. This is the trade in [docs/vpc.md](../../../docs/vpc.md#egress-from-a-private-subnet), taken because a NAT gateway costs more per month than everything else here combined.

**Egress is unrestricted.** Any process on the instance can reach any host, which is the path a compromised dependency takes to exfiltrate data or call home. It is open deliberately: the alternative is an allowlist covering ECR, Systems Manager, ACME and package mirrors, which is a moving target maintained by hand. AWS managed prefix lists make it tractable, and the trigger is the instance holding customer data rather than test rows.

**Port 80 is open and must serve nothing.** It exists for the redirect to 443 and the ACME HTTP-01 challenge. A plaintext listener that answers anything real is a downgrade path; switching the proxy to the TLS-ALPN-01 challenge closes the port outright.

**Nothing rate limits ahead of the instance.** A reverse proxy's rate limiting runs in the instance's own process, so an attack has already spent its bandwidth and CPU by the time a limit applies. Absorbing traffic before it arrives is what a load balancer with WAF rate rules buys.

**IPv4 rules do not cover IPv6.** Inert while the VPC has no IPv6 block, and not inert the moment one is added: a rule written with `cidr_ipv4` ignores IPv6 traffic entirely, so a subnet given an IPv6 range with unchanged security groups is open in a way the configuration does not show.

**There is no network-level record.** CloudTrail answers what was called on the AWS API, never what connected to what. Flow logs answer the second question and are off for cost, which means an investigation into a suspected intrusion starts with no packet history.

**The emptied default group fails closed, and confusingly.** Anything created without an explicit security group lands in the default one, which now permits nothing. That is the safe direction, but the symptom is a resource that times out rather than one that reports a denial.

## What it does not cover

**No NAT gateway.** The instance goes in a public subnet with a locked security group instead, trading a second layer of defence for a fixed cost larger than the rest of the infrastructure. [docs/vpc.md](../../../docs/vpc.md#egress-from-a-private-subnet) has the full comparison and what would justify reversing it.

**No interface endpoints.** They are billed per endpoint per availability zone, and Systems Manager reaches its endpoints over the internet in this layout. They start earning their place when the instance moves to a private subnet.

**No flow logs.** The VPC feature is free; the CloudWatch Logs ingestion it produces is not. They belong to a network-audit requirement or a live investigation, not to a baseline.

**No network ACLs.** The default one allows everything, which is correct. NACLs are stateless and every allowed flow needs a matching return rule on the ephemeral port range — they earn their place for a blanket subnet-wide deny and nowhere else.
