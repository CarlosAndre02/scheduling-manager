# Networking

The network model this project's AWS infrastructure is built on: how a VPC isolates workloads, how a subnet becomes public or private, and how a packet is or is not allowed through. How the infrastructure is cut into Terraform stacks is in [aws-stack-implementation.md](aws-stack-implementation.md); identity and cost are in [aws-governance.md](aws-governance.md).

## Why a VPC at all

There is no such thing as an EC2 instance served "directly on the internet". EC2-Classic is retired, so every instance launches inside a VPC and the only real choice is between the **default VPC** and one designed for the workload.

A VPC is a logically isolated network inside a region: a private IP range that is yours, invisible to every other customer, whose reachability you define. Two instances in different VPCs cannot address each other at all, no matter what their firewall rules say.

The default VPC exists so that a first instance answers on the internet without reading any of this. Every property that makes it convenient is one nobody would choose deliberately:

| Default VPC                                    | Consequence                                                |
| ---------------------------------------------- | ---------------------------------------------------------- |
| One public subnet per AZ, all routed to an IGW | There is nowhere to put something that must stay private   |
| Auto-assign public IPv4 on                     | Every instance is addressable from the internet by default |
| Default security group allows all of itself    | Any instance reaches any other, on any port                |

The gain from a designed VPC is that **unreachable and firewalled become two different states**. A security group can refuse a packet; routing and addressing can make it so no packet is ever sent. A database in a private subnet with no public address is not protected by a rule someone could edit — it has no path. Two independent mechanisms have to fail before it is exposed.

## Addressing

The VPC's CIDR block (between `/16` and `/28`) is fixed at creation. Secondary blocks can be added later, but the primary cannot change, and **two VPCs with overlapping ranges can never be peered** — re-addressing means rebuilding. Choosing a range that does not collide with a corporate network or a future account costs nothing at creation and is expensive to correct.

AWS reserves five addresses in every subnet (network address, VPC router, DNS, one held for future use, and broadcast), so a `/28` yields 11 usable addresses rather than 16.

## Availability Zones

An AZ is one or more datacenters with independent power, cooling and network, physically separated enough that one failure does not take another down, and close enough that latency between them stays in single-digit milliseconds. A region is a group of AZs. **A subnet lives in exactly one AZ**, which makes the subnet layout the thing that decides the failure domain.

Two properties are worth knowing before designing around them:

- **AZ names are per-account aliases.** `us-east-1a` in two different accounts usually maps to two different physical zones. The stable identifier is the AZ ID (`use1-az1`), and anything that must line up across accounts has to use it.
- **Crossing an AZ is not free.** Instance-to-instance traffic between AZs is billed per GB in each direction where same-AZ traffic is not, and adds latency. Several managed services are exceptions, so confirm per service rather than assuming either way.

**Two AZs are a hard API requirement in more places than load balancing:**

| Resource            | Requires                                                     |
| ------------------- | ------------------------------------------------------------ |
| ALB                 | at least 2 subnets in 2 distinct AZs                         |
| RDS DB subnet group | subnets in at least 2 AZs, **even for a Single-AZ instance** |

The second one surprises people who deliberately avoided Multi-AZ to halve the cost: the subnet group declares where a failover _could_ place the instance, so it is demanded whether or not one is configured. Empty subnets cost nothing, which makes creating the second AZ upfront the cheap answer — retrofitting it means touching the subnet group of a live database.

## Subnets, route tables and the internet gateway

Public and private are not attributes of a subnet. They are **a line in a route table**:

```
public   0.0.0.0/0 → igw-…      ← this, and only this, is what makes it public
private  0.0.0.0/0 → nat-…  or  no default route at all
```

Every subnet is associated with exactly one route table, falling back to the VPC's main table. Both kinds always carry an implicit local route for the VPC's own CIDR, which is why any two subnets in a VPC can talk to each other without configuration — subnets do not isolate, security groups do.

The **internet gateway** is attached to the VPC, horizontally scaled, without a bandwidth limit, and free. It performs one-to-one NAT between an instance's private address and its public one, which is why the operating system never sees the public address: `ip addr` on a public instance shows only the private IP.

Three conditions must hold simultaneously for an instance to be reachable from the internet:

1. its subnet's route table has a default route to the IGW,
2. its network interface carries a public IPv4 (auto-assigned or an Elastic IP),
3. its security group allows the inbound port.

Breaking any one of the three is enough. That is what makes layered defence inexpensive here — the layers already exist and are independent.

**Every public IPv4 address is billed hourly**, attached or idle, and that includes the addresses held by NAT gateways and load balancers. Elastic IPs are not an exception.

### Where the public address actually lives

A public IPv4 address is never configured on the instance. It is an entry in the AWS network's mapping table, applied by a gateway — and the two gateways translate differently, which is the entire difference between them:

| Gateway     | Translation                                        | Direction                          |
| ----------- | -------------------------------------------------- | ---------------------------------- |
| IGW         | one-to-one: one public address per private address | either way, so inbound is possible |
| NAT Gateway | many-to-one, flows distinguished by port           | outbound only, by construction     |

Both are NAT. Only the IGW's mapping can be entered from the outside.

The practical consequence is that software cannot read its own public address from the interface — `ip addr` shows the private one — and has to ask the instance metadata service at `169.254.169.254`. Anything written to bind to "its public IP" fails on EC2 for this reason.

**IPv6 does not work this way.** IPv6 addresses are globally routable and configured directly on the interface, so no translation happens at all and the IGW routes rather than rewrites. Outbound-only access is then provided by an **egress-only internet gateway**, which is free — the NAT gateway's cost has no IPv6 equivalent.

## Traffic inside the VPC

Traffic between two resources in the same VPC — an instance and its database, two instances in different subnets, two subnets in different AZs — is carried by the VPC router over the implicit local route. **It never reaches the internet gateway or the NAT gateway.** Those are consulted only for destinations outside the VPC's CIDR.

The line that matters is not "AWS or not AWS", it is "inside this VPC or not":

| Destination                                                       | Path                                            |
| ----------------------------------------------------------------- | ----------------------------------------------- |
| another instance, an RDS endpoint, an interface endpoint's ENI    | local route, private addresses, no gateway      |
| S3, ECR, Secrets Manager — any AWS service without a VPC endpoint | out through the IGW or NAT, as internet traffic |
| anything else                                                     | IGW or NAT                                      |

The second row is the one that surprises: **calling an AWS API is not internal traffic.** An instance in a private subnet with no NAT gateway and no endpoint cannot reach S3, even though both are AWS and both are in the same region. Moving that row up into the first is exactly what VPC endpoints are for.

### Finding the other side

Nothing in a well-built VPC addresses another component by IP, for the same reason security group rules reference groups instead of CIDRs: an address belongs to an instance, and instances get replaced. Names come from four places:

- **The VPC resolver.** Every VPC runs one, reachable at the CIDR's base address plus two (`10.0.0.2` for `10.0.0.0/16`) and at `169.254.169.253`. With `enableDnsHostnames`, every instance also gets an internal name of the form `ip-10-0-1-23.<region>.compute.internal` resolving to its private address.
- **Managed service endpoints.** RDS hands out a DNS name, never an address, and the connection string names it — a failover that moves the database to a different address changes nothing in the application.
- **A Route 53 private hosted zone**, for names you choose (`db.internal.example.com`), resolvable only from associated VPCs.
- **Service discovery** (Cloud Map), for workloads whose members come and go — what ECS uses when tasks have no stable address at all.

**Split-horizon resolution** is what keeps this cheap: a public AWS endpoint name resolves to the _private_ address when queried through the VPC resolver, and to the public one from outside. Two resources in the same VPC therefore talk over the local route instead of leaving through the internet gateway and being billed as data transfer. Hardcoding an external DNS server on the instance silently defeats it.

## Reaching an instance that has no public address

An instance with no public address cannot be reached from the internet — which is the point, and which includes not being reachable by its owner. The console is not the answer for real work.

**Systems Manager Session Manager** is: the SSM agent on the instance opens an _outbound_ connection to the Systems Manager service and holds it, and shell sessions are delivered back over it. No inbound rule, no public address, no key pair, no bastion. The security group can have zero inbound rules and still be administrable.

Three requirements, and the third fails silently:

1. the SSM agent, preinstalled on current Amazon Linux and Ubuntu images,
2. an instance profile granting `AmazonSSMManagedInstanceCore`,
3. **a route to the SSM endpoints** — via the internet (public subnet or NAT) or via three interface endpoints (`ssm`, `ssmmessages`, `ec2messages`).

The third is why the egress decision and the access decision are the same decision: an instance in a private subnet with no NAT gateway needs roughly US$20/month of interface endpoints before anyone can open a shell on it.

What it provides beyond a shell:

- **Port forwarding**, which reaches a private database from a laptop through the instance without opening SSH or running a tunnel — `aws ssm start-session --document-name AWS-StartPortForwardingSessionToRemoteHost`.
- **An audit trail.** Every session is an API call in CloudTrail and session output can be shipped to S3 or CloudWatch Logs. An SSH key produces no such record.
- **Nothing to lose.** Access is granted by IAM policy and revoked by removing it, instead of by tracking which laptops hold which key.

For contrast: an **EC2 Instance Connect Endpoint** gives the same reachability for native SSH, at the price of managing keys again; a **bastion host** is the legacy pattern, costing an instance, a public address, an open port and a key, in exchange for nothing Session Manager does not already do.

## Egress from a private subnet

An instance in a private subnet has no route out. Everything it initiates fails: pulling an image from ECR, calling an AWS API, fetching a package, reaching an SMTP provider. Giving it egress has three answers with very different bills.

### NAT Gateway

A managed service placed in a **public** subnet, holding an Elastic IP. The private subnet's route table points its default route at it; the gateway rewrites the source address of outgoing packets to its own and keeps a translation table so replies find their way back.

Its security property comes from being one-directional: the translation table only has entries for flows the instance started, so there is no way to address the private instance from outside. It is not a firewall — it is an address translator whose design has no inbound path.

Two costs, and the fixed one dominates at small scale: an hourly charge that runs whether or not a byte moves (in the order of US$30/month), plus a per-GB processing fee on everything that passes through, in both directions. It is also **AZ-scoped**: a gateway lives in one AZ, and private subnets routed to it lose egress when that AZ fails, so real redundancy means one per AZ and double the fixed cost.

The trap worth naming: traffic from a private subnet to S3 **in the same region** still goes through the NAT gateway and still pays the per-GB fee, unless a gateway endpoint exists.

### Public subnet with a locked security group

The instance sits in a public subnet with a public address, and its security group admits nothing inbound except from the component in front of it, while egress stays open. Outbound traffic goes straight through the internet gateway, which is free.

The security is equivalent for inbound purposes — the security group is what refuses connections in both designs, and it is the same rule. What is lost is the second, independent layer: in a private subnet, a security group misconfigured to allow the world still leaves the instance without a public address to reach. Here, that single mistake is enough to expose it.

That is a defence-in-depth trade, made deliberately: for a workload whose entire infrastructure budget is a few tens of dollars, a fixed US$30/month line item for a second layer is the wrong allocation. It should be revisited when the workload's value rises, and the migration is a route table change plus a NAT gateway, with the instances untouched.

### VPC endpoints

Endpoints connect a VPC to AWS services over the AWS network without traversing the internet at all. There are two kinds, and confusing them makes the whole option look either free or unaffordable:

| Kind          | Services                                | Mechanism                                          | Cost                                        |
| ------------- | --------------------------------------- | -------------------------------------------------- | ------------------------------------------- |
| **Gateway**   | S3 and DynamoDB only                    | a prefix-list route added to the route table       | **free**                                    |
| **Interface** | everything else (ECR, Secrets, Logs, …) | an ENI with a private IP inside each chosen subnet | hourly **per endpoint per AZ**, plus per-GB |

The gateway endpoint is free and should exist wherever a private subnet talks to S3, since it removes NAT processing charges outright.

Interface endpoints are what make this option expensive: the hourly rate is small, but it multiplies by the number of services and by the number of AZs. Pulling an image from ECR privately needs `ecr.api`, `ecr.dkr` and the S3 gateway endpoint for the layers; add Secrets Manager and CloudWatch Logs and the monthly total passes what a NAT gateway would have cost. **Endpoints replace a NAT gateway only when few services are needed or when the per-GB volume is large enough for the processing fee to dominate the fixed one.**

### Choosing between them

|                           | Fixed cost                                | Per-GB         | Inbound path exists     | Covers                   |
| ------------------------- | ----------------------------------------- | -------------- | ----------------------- | ------------------------ |
| NAT Gateway               | high, per AZ                              | yes            | no                      | the whole internet       |
| Public subnet + locked SG | none                                      | none           | only what the SG allows | the whole internet       |
| VPC endpoints             | per endpoint per AZ, free for S3/DynamoDB | interface only | no                      | listed AWS services only |

They are not mutually exclusive, and the useful combination is a NAT gateway or public placement for general egress **plus** the free S3 gateway endpoint.

A fourth option exists and is deliberately not used: a **NAT instance**, an EC2 running NAT software, which costs a few dollars a month on the smallest instance type. It reintroduces exactly what a managed service removes — patching, monitoring, a single point of failure, and a bandwidth ceiling tied to the instance size — in exchange for a saving that only matters at the scale where operating it is least affordable.

## Security groups

A security group is a stateful, allow-only firewall attached to **network interfaces**, not to instances or subnets. Its behaviour follows a few rules that explain most of the confusion around it:

- **There are no deny rules.** Everything not matched by an allow rule is denied. A rule can only widen access, so rules never conflict and order is irrelevant.
- **It is stateful.** Allowing an inbound port automatically allows the reply. There is no return rule to write.
- **Rules take a security group as a source, not just a CIDR.** This is the mechanism that matters most, and the reason for the design below.

### The chain

```
internet ──443──▶ [sg_edge] ──app port──▶ [sg_app] ──5432──▶ [sg_db]
                              source:                source:
                              sg_edge                sg_app
```

The database's rule says "accept 5432 from whatever is in `sg_app`". It never names an address. Membership is evaluated live against the private IPs of the interfaces in the referenced group, so replacing the instance, adding a second one, or moving the workload to Fargate is automatically covered, and **there is no IP an attacker could impersonate** — there is no IP in the rule at all.

Each link is also a statement that survives review: nothing but the edge reaches the application port, and nothing but the application reaches the database. Reading three small groups answers "what can reach the database" completely, which a list of CIDRs never does.

**The chain has one link per separately addressable component, not three by definition.** A reverse proxy running on the same host as the application shares its network interface, so `sg_edge` and `sg_app` are the same group: it admits 443 from the internet, and the application port is never exposed at all because the proxy reaches it over the loopback or a container network. Creating two groups there would be describing a boundary that does not exist. The third link appears the moment the proxy moves off the host — onto a load balancer — and that is a group added in front, not a rewrite of the existing rules.

`publicly_accessible = false` on RDS belongs to the same idea but is a different mechanism: it controls whether the instance gets a **public DNS record**, so with it off and the instance in a private subnet, the endpoint resolves only inside the VPC. The security group refuses connections; this removes the address to connect to.

### Working with them in Terraform

- **Declare egress explicitly.** AWS attaches an allow-all egress rule to every new security group. Terraform treats an `aws_security_group` with no `egress` block as "no egress at all" and removes it — the workload then fails to reach anything outbound, with a timeout as the only symptom.
- **Use the separate rule resources** (`aws_vpc_security_group_ingress_rule` / `_egress_rule`) rather than inline blocks. Inline blocks and separate resources cannot be mixed on the same group without producing a permanent diff, and only the separate form can express two groups that reference each other — inline blocks would need each group to exist before the other.

### Network ACLs are a different tool

NACLs are stateless, apply at the subnet level, evaluate numbered rules in order, and support deny. Statelessness is what makes them a poor default: every allowed flow needs a matching rule for the return traffic on the ephemeral port range, and forgetting it produces failures that look like anything but a firewall. They earn their place for a blanket deny across a whole subnet, such as blocking a hostile range, and nowhere else. The default NACL allows everything, which is the right setting to leave alone.

## The public entry point

Something has to terminate TLS and own the name the world resolves — the component protected by `sg_edge` above. Four can play that role, and they differ in much more than load balancing:

|                               | TLS certificate               | WAF attachable | Rate limiting            | Fixed cost                                     | Also provides                                     |
| ----------------------------- | ----------------------------- | -------------- | ------------------------ | ---------------------------------------------- | ------------------------------------------------- |
| Reverse proxy on the instance | Let's Encrypt, you operate it | no             | in-process, per instance | none                                           | routing, middleware                               |
| ALB                           | ACM, managed                  | yes            | no — needs WAF           | hourly + capacity units                        | health checks, connection draining, target groups |
| CloudFront                    | ACM, managed                  | yes            | via WAF                  | none; per request and per GB, with a free tier | edge TLS termination, caching, absorbs volume     |
| API Gateway                   | ACM, managed                  | REST API only  | native and granular      | none; per request                              | authorizers, usage plans, request validation      |

Three properties decide between them more often than the price does:

- **A per-request price is unbounded under abuse.** An ALB bills hourly plus capacity; CloudFront and API Gateway convert traffic directly into invoice. For a workload with a spending guardrail, that argues for a WAF rate rule in front of them rather than for choosing them on low idle cost — see [aws-governance.md](aws-governance.md).
- **A load balancer is how orchestrated containers get registered**, not merely how load is spread. ECS adds and drains tasks through a target group, so without one there is no zero-downtime deployment on Fargate. That is why the ALB stops being optional at that point, and stops being optional earlier than that as soon as a second instance exists.
- **An edge is only real if the origin cannot be reached directly.** CloudFront in front of an instance whose security group still admits the world is theatre — the origin address is discoverable and the edge is simply bypassed. The origin's group has to be restricted to CloudFront's managed prefix list, or the origin has to be private behind a VPC origin.

Reaching the instance through **API Gateway** carries a structural catch: a private target requires a VPC Link, and a VPC Link points at an NLB or an ALB. Keeping the instance private under API Gateway reintroduces a load balancer, so the only configuration that avoids one leaves the instance publicly addressable behind a shared secret.

### The rule this project follows

The entry point is a reverse proxy on the instance, and the network is laid out so a load balancer can be introduced without redesigning it. Four properties make that true, and each costs nothing to preserve:

- **two public subnets in two AZs from the start**, because empty subnets are free and the ALB's two-AZ requirement cannot be satisfied retroactively without touching live resources;
- **the public name is a Route 53 record**, so replacing the entry point is a record change rather than a client change;
- **the application speaks plain HTTP internally** and never terminates TLS itself, so whatever terminates it is replaceable;
- **the number of proxies in front is configuration** (`TRUSTED_PROXY_HOPS`), because `X-Forwarded-For` gains a hop with every component added in front — see [architecture.md](architecture.md).

The migration is then additive: create the load balancer, register the instance, verify against the load balancer's own DNS name, switch the Route 53 record, and only then narrow the instance's security group to accept from the load balancer's group. Every step is reversible by switching the record back, and none of them touches the application.

**A load balancer earns its place** when a second instance or service exists, when managed WAF rules are required, when deployments must not drop connections, or when the workload moves to Fargate — where it is mandatory.

**CloudFront earns its place** on a different trigger: a geographically spread audience, cacheable responses, or a data-transfer-out bill large enough for its cheaper per-GB rate and free tier to matter. It is not a substitute for the load balancer and does not become one; the two compose, with CloudFront in front. Adding it without locking the origin to its prefix list buys nothing.
