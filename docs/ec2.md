# The application host

How the application actually runs: one EC2 instance, a reverse proxy terminating TLS, and the application containers behind it. The stack that creates it is [infra/terraform/compute](../infra/terraform/compute); this page is the reasoning, and [vpc.md](vpc.md#the-public-entry-point) is the network it sits in.

```
internet ──▶ Elastic IP ──▶ Traefik ──▶ app ×N ──▶ Supabase
                            :80 :443    :4000       (public internet)
                               │
                        socket-proxy ──▶ Docker API
```

## One instance, and what that gives up

An Auto Scaling group with a single instance is the usual recommendation, and it buys two real things: replacement when the EC2 status check fails, and a rolling replacement when the launch template changes. It costs three:

- **The address stops being declarative.** An instance created by a group has no name to attach an Elastic IP to, so the association moves into user data or a lifecycle hook — the first imperative step in a declarative stack.
- **Replacement is a certificate request.** A new instance means a new volume, so ACME storage is lost and a certificate is issued again, against a duplicate-certificate limit that a rebuild loop reaches quickly.
- **Scheduled stop and self-healing cancel each other.** Scheduled scaling does not stop instances, it replaces them; keeping a group from fighting a stop schedule means suspending its health check, which suspends the self-healing that justified the group.

**Raising capacity does not scale anything without a load balancer.** Two instances and one DNS record is one instance serving and one idle, and only one of them can hold the Elastic IP. A group is a recovery mechanism until an ALB exists, never a scaling one.

## ALB, ACM and WAF are one decision, not three

Dropping the load balancer drops the other two, because neither has anywhere else to attach:

- **ACM will not export a private key** for a public certificate. Its certificates install onto AWS-managed endpoints — ALB, NLB, CloudFront, API Gateway — and onto nothing you operate yourself.
- **AWS WAF attaches to** CloudFront, an ALB, API Gateway, AppSync, App Runner and Cognito. There is no such thing as a WAF on an instance or on an Elastic IP.

| Dropped | Replaced by                            | Not replaced                                                  |
| ------- | -------------------------------------- | ------------------------------------------------------------- |
| ALB     | Elastic IP, a Route 53 record, Traefik | balancing across hosts, draining between hosts, AZ failover   |
| ACM     | Let's Encrypt through the proxy        | renewal being somebody else's problem                         |
| WAF     | proxy middlewares, security groups     | managed rule sets, and **absorbing volume before it arrives** |

The last one is the only irreplaceable loss. A limit enforced by the proxy runs after the traffic has already cost the instance its bandwidth and its CPU.

## Sizing

### Tenancy

Three allocations exist and only the first is relevant here.

| Allocation         | What you get                                            | Why it exists                                                            |
| ------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------ |
| Shared             | a VM on hardware shared with other accounts             | the default, and the only one priced per instance alone                  |
| Dedicated instance | a VM on hardware no other **account** uses              | compliance rules that forbid shared hardware                             |
| Dedicated host     | the physical server, with its sockets and cores visible | licences bound to physical cores — bring-your-own Windows Server, Oracle |

Dedicated instance adds a regional hourly fee on top of a higher instance price; a dedicated host is billed as the whole machine. Both are answers to a licensing or an audit requirement, and paying for either without one is buying isolation nothing asks for. **Shared is the choice, by leaving `tenancy` unset** — on the instance and on the VPC, since a VPC created with `instance_tenancy = "dedicated"` forces every instance inside it to be dedicated regardless of what the instance says.

### Why `small` and not `micro` or `nano`

Every t4g size has 2 vCPU. What changes is memory and the baseline share of CPU the credit system grants.

| Size        | Memory  | CPU baseline | Monthly  |
| ----------- | ------- | ------------ | -------- |
| `t4g.nano`  | 0.5 GiB | 5%           | US$3.07  |
| `t4g.micro` | 1 GiB   | 10%          | US$6.13  |
| `t4g.small` | 2 GiB   | 20%          | US$12.26 |

**Memory decides it, not price.** The proxy, the socket proxy and two application replicas measure around 270 MiB at rest; the Docker daemon, the SSM agent and the operating system take roughly another 400 MiB. That is about 700 MiB before a single request arrives, and a Node heap grows under load rather than staying flat.

On `nano` the stack does not fit at rest. On `micro` it fits at rest and has a few hundred MiB of headroom, which the kernel takes from whichever process asked last — and an OOM kill of a Node process is indistinguishable from a crash while it is happening. `small` is the first size where the headroom exceeds the working set rather than matching it.

The CPU baseline matters for a second reason. Burstable instances earn credits at a rate set by size and, in the default `unlimited` mode, **bill surplus CPU rather than throttling it**. A smaller instance under the same load does not run slower — it produces a larger invoice, silently.

### The architecture has to match, and nothing tells you when it does not

Graviton is arm64. An image built on an x86 runner is amd64, and every step between the two accepts the mismatch without a word: the build succeeds, the vulnerability scan succeeds, the registry accepts the push, the host pulls it, and Docker creates the container. It then dies in milliseconds with an exec format error and restarts forever.

**The symptom points at the wrong component.** The proxy is healthy, so it answers — with its default `404 page not found`, because a container that is restarting is not a container the Docker provider will route to. Nothing in the chain says "wrong architecture" except the container's own stderr, which is on the host and thrown away every restart. The one place it is visible from outside is the kernel ring buffer, where a network interface appears and is unregistered ninety milliseconds later, on a loop.

Two things keep the agreement honest, and both are needed because neither sees the other: the pipeline builds on an arm64 runner and **asserts the built image's architecture** before publishing it, and the instance type variable refuses anything but a Graviton family. Changing one means changing the other.

### How many containers

Node executes JavaScript on one thread. One container is one process is one core, and the libuv thread pool only covers file, DNS and crypto work — none of which this application does once the proxy terminates TLS.

The workload is I/O bound: parse, validate, one or two queries, serialize. A single process handles a great deal of concurrency because waiting on Postgres does not occupy the thread. So a second container is **not** primarily about throughput:

- **Throughput** only improves when JavaScript CPU is the ceiling. If the ceiling is query latency or the connection pool, another process changes nothing.
- **Availability** improves immediately. Docker marks an unhealthy container and _does nothing about it_ — restart policies react to a process exiting, not to a failing health check. With one container a wedged process is an outage; with two the proxy routes around it.

Two is the floor worth running, and the reason is the second bullet.

**The connection pool multiplies, so it has to be divided.** `DATABASE_POOL_MAX` is per container, and N containers against a pooler with a fixed pool size will exhaust it. The compute stack derives each container's share from `database_pool_size / app_replicas` at deploy time rather than leaving the invariant to a comment.

**Fixed at the maximum, never elastic.** The instance is billed by the hour whether the containers run or not, so stopping a container returns memory and no money. Elasticity is worth building where the resource costs money — at the instance level — and there it needs a load balancer first.

## The reverse proxy

### Discovery instead of configuration

With static configuration, changing the number of backends means rewriting an upstream block and reloading. With a proxy that reads the Docker API, containers announce themselves through labels and scaling is `docker compose up -d`. Nothing regenerates.

That is the whole reason to prefer Traefik or Caddy over nginx here, and it survives the move to a load balancer: the ALB balances between machines while the proxy inside each one keeps working unchanged.

### The Docker socket is root

`/var/run/docker.sock` is root-equivalent: anything that can talk to it can start a privileged container that mounts the host filesystem. **Mounting it read-only does not help** — creating a container is a `POST`, and a read-only bind mount does not make the API refuse writes.

The proxy is the most exposed process on the host, so it does not get the socket. A socket proxy sits between them, exposes the read endpoints discovery needs, and refuses everything else. The application containers are on a separate Docker network that cannot reach it at all.

## TLS

### What it is, and what it actually protects

TLS gives a connection three properties, and the third is the one people forget:

- **Confidentiality** — nobody between the client and the server reads the traffic.
- **Integrity** — nobody between them modifies it undetected.
- **Authentication** — the client knows it is talking to the server it asked for.

Encryption without authentication is close to worthless on a public network: an attacker who can put themselves in the path simply terminates the connection themselves, and an encrypted conversation with an impostor reveals exactly as much as a plaintext one. This is the same reason [supabase.md](supabase.md#tls-has-to-be-configured-in-code) refuses to disable certificate verification on the database connection.

### Certificates

A certificate is a public key plus a name, signed by somebody the client already trusts. The chain is what makes it work:

1. The server presents its certificate — "this public key belongs to `api.example.com`" — signed by an intermediate authority.
2. The intermediate is signed by a root authority.
3. The root is already in the client's trust store, shipped with the operating system or the browser.

The client verifies the signatures back to a root it holds, then proves the server owns the matching private key. **The trust store is the anchor**, which is exactly why a self-signed root — Supabase's, for example — must be supplied to the client explicitly: there is no path from it to anything already trusted.

Certificates expire. Expiry **fails closed**: connections stop rather than degrade.

### Let's Encrypt and ACME

Let's Encrypt is a certificate authority that issues free, publicly trusted certificates through an automated protocol, **ACME**, instead of a purchase and a support ticket. It replaces ACM in this architecture because it is the only kind of authority that will issue to a machine you operate yourself.

The certificates are valid for 90 days by design. Short lifetimes make automated renewal mandatory, which is the point: a renewal path that runs every 60 days is one that is known to work, where an annual manual renewal is discovered to be broken on the day it fails.

### The challenge

Before issuing, the authority has to establish that the requester actually controls the name. That proof is the **challenge**:

| Challenge     | How control is proven                                                         | Needs          |
| ------------- | ----------------------------------------------------------------------------- | -------------- |
| `HTTP-01`     | serve a token at `http://<domain>/.well-known/acme-challenge/<token>`         | port 80        |
| `TLS-ALPN-01` | answer the TLS handshake on 443 with a special certificate carrying the token | port 443       |
| `DNS-01`      | publish a TXT record under `_acme-challenge.<domain>`                         | DNS API access |

`TLS-ALPN-01` is preferable here for a specific reason: it lets port 80 serve nothing but a redirect. A plaintext listener that answers anything real is a downgrade path, and closing that off is worth more than the simplicity of `HTTP-01`. `DNS-01` is the only one that works for a wildcard or for a host with no inbound port open, at the cost of handing the proxy credentials to edit DNS.

### The staging endpoint

Let's Encrypt runs a parallel environment that speaks the same protocol and issues certificates signed by a root **no browser trusts**. Its rate limits are effectively unlimited.

That is what makes it the right setting while infrastructure is being iterated on. Production allows **five certificates per week for an identical set of names, refilling one every 34 hours**. Normal operation never approaches it — a 90-day certificate renewed at 60 days is one issuance every two months. A loop that rebuilds the host exhausts it in an afternoon, and then the name has no certificate for a day and a half at a time. The limit is a development hazard, not a traffic one.

Renewal is treated more generously than first issuance: a renewal for an identical set of names is exempt from the per-domain and per-account limits, though not from this one.

The rule: staging until the boot sequence is known to work, then production once.

### A certificate without a domain

A publicly trusted certificate does not strictly require a domain. Let's Encrypt issues for **bare IP addresses**, which an Elastic IP satisfies, under three constraints:

- the `shortlived` certificate profile is mandatory, and those certificates are valid for about **six days**;
- only `HTTP-01` and `TLS-ALPN-01` prove control of an address — `DNS-01` cannot;
- the per-identifier limit treats the exact IPv4 address as the registered domain.

Six-day validity is not a drawback here so much as a different operating point: renewal has to run every couple of days rather than every couple of months, which is fine for a process that renews automatically and fatal for one that does not. A resolver configured this way needs its renewal window told to it, because a proxy assuming 90-day certificates would try to renew a six-day one thirty days before it expires — a date already in the past.

It is the right tool for proving the TLS path works before a domain exists, and the wrong one to leave in place: an address is not a name, so moving the service means every client changes.

### Why the certificate is the instance's only real state

ACME storage is a file. Replace the instance and it is gone, and the replacement asks for a new certificate — which is why the weekly limit is an operational concern rather than a footnote, and why [aws-stack-implementation.md](aws-stack-implementation.md#keeping-compute-disposable) treats it as the first thing that makes a host non-disposable.

## Throttling

### Three limits that measure different things

| Limit      | Counts                                                    | Catches                                             |
| ---------- | --------------------------------------------------------- | --------------------------------------------------- |
| `average`  | requests per second                                       | a script hammering an endpoint                      |
| `burst`    | how far above `average` a caller may go before throttling | a page that fires several calls on load             |
| `inFlight` | requests **at the same time**                             | a caller that opens many connections and holds them |

`average` and `burst` are one mechanism — a token bucket. The bucket holds `burst` tokens, each request takes one, and tokens refill at `average` per second. A caller who stays under the average never notices; one who exceeds it drains the bucket and is throttled from then on.

**In-flight is not a stricter version of the rate limit, and it does not dominate it.** Which one binds depends entirely on how long a request takes:

- Requests answered in 2 ms never overlap enough to reach an in-flight limit of 20 — a caller would need 10,000 requests per second to hold 20 simultaneously. The rate limit is the only thing that fires.
- Requests that take 4 seconds hit the in-flight limit at 5 requests per second, far below any sensible `average`. The rate limit never fires.

The second case is the one a rate limit cannot see at all: a client uploading a body one byte at a time makes _one_ request while occupying a connection indefinitely. That is what the in-flight limit and the entry-point read timeouts exist for.

### Where they run, and what that costs

Every limit here executes in the proxy's own memory, on the instance. Two consequences:

- **The traffic has already arrived.** Bandwidth and CPU were spent before the rejection. Absorbing volume before it reaches the host is what a WAF rate rule in front buys, and there is no substitute at this layer.
- **The counters are per process.** Behind a load balancer with several instances, each enforces its own limit and the effective ceiling multiplies by the number of them.

### Counting proxies correctly

Anything keyed on the caller's address depends on knowing how many proxies are in front, and the number appears in two places that must move together:

- `TRUSTED_PROXY_HOPS` in the application — see [architecture.md](architecture.md#input).
- `ipStrategy.depth` in the proxy's rate-limit middleware.

With the proxy accepting connections directly from the internet, it is one hop for the application and zero for the proxy. Adding a load balancer or a CDN increments both. **Getting it wrong in the safe direction limits per proxy** — everyone shares one counter. In the unsafe direction a caller forges `X-Forwarded-For` and resets its own counter at will.

### The firewall is the security group

Worth stating plainly, because "firewall" gets used for all of these:

- A **security group** decides who may open a socket. It is stateful, allow-only, and counts nothing.
- A **NACL** is the tool for a blanket deny of a hostile range across a subnet, and nothing else — see [vpc.md](vpc.md#network-acls-are-a-different-tool).
- **Host firewalls** duplicate the security group and add a second place to get the same rule wrong.
- **AWS Shield Standard** is free, automatic, and covers volumetric attacks at layers 3 and 4. It does nothing about a flood of well-formed HTTP requests.

## Deploying

### The image tag does not live in user data

Cloud-init runs user data **once**, on the first boot. Anything baked into it can only be delivered by replacing the instance — which here means downtime plus a certificate request against the weekly limit. So the split is:

| Lives in user data                                     | Lives in Parameter Store                  |
| ------------------------------------------------------ | ----------------------------------------- |
| what the machine _is_ — packages, layout, config files | what it _runs_ — image tag, replica count |

A release updates a parameter and runs the deploy script. The machine stays. The same two calls are what a CD job would make.

This is also why `user_data_replace_on_change` is false. Since cloud-init will not re-run regardless, the only question the setting answers is whether Terraform destroys the host to deliver a template edit — and on a single instance that must be a decision, not a side effect.

**Configuration that a running system needs to change under pressure is the exception.** The proxy's dynamic file is watched and reloaded in place, so a limit can be re-tuned in seconds over Session Manager during an incident. Folding the same value back into Terraform afterwards is what keeps the declaration honest.

### Draining, and the three timeouts that have to agree

A restart drops no requests only because three components agree:

1. The application answers `503` on `/health` while draining, and keeps serving real endpoints normally.
2. The proxy health-checks that path and takes the draining container out of rotation.
3. Docker waits long enough for both to happen.

**The third is the one that silently is not true by default.** Docker's stop grace period is 10 seconds; a drain delay of 15 plus a shutdown timeout of 15 needs up to 30. Without `stop_grace_period` raised past the sum, `SIGKILL` lands mid-drain, the process never closes its listeners, and in-flight requests are cut — the exact failure the graceful shutdown exists to prevent. The only trace it leaves is an exit code of 137.

The health check interval and the drain delay have to agree too: a drain shorter than the polling interval finishes before the proxy notices it started.

## Stopping and starting

Everything the host needs survives a stop, provided the stop is a stop and not a termination:

|                                         | Across a stop                                                    |
| --------------------------------------- | ---------------------------------------------------------------- |
| Elastic IP                              | stays associated — the address does not change                   |
| Root volume, and the ACME storage on it | preserved; `delete_on_termination` applies to termination only   |
| Private address                         | preserved, since the network interface is the same one           |
| Containers                              | restarted on boot by the daemon, under `restart: unless-stopped` |
| Accrued CPU credits                     | **kept for seven days**, then lost                               |

The credit line is the one that surprises people, and the surprise usually runs the wrong way: the older T2 family loses its credits the moment an instance stops, which is what most material describes. T4g keeps them for a week.

Nothing is reconfigured on start. Cloud-init does not re-run, and it does not need to — the image is already on the volume, so the containers come back without a registry login. The two things that do change are worth knowing: the boot takes tens of seconds before anything answers, so the first request of the day cannot be the trigger; and a stop long enough for a certificate to expire means the proxy renews on start, which is a request against the rate limit rather than a failure.

What does **not** stop being billed is storage and the address — see the cost table below, where they are more than a third of the total.

## Cost

Prices are `us-east-1` and change; the shape is what matters.

| Item                            | Monthly  |
| ------------------------------- | -------- |
| `t4g.small`                     | US$12.26 |
| 20 GB gp3 root volume           | US$1.60  |
| Elastic IP (in-use public IPv4) | US$3.65  |
| ECR storage                     | cents    |
| Route 53 hosted zone            | US$0.50  |

Free at this scale: Parameter Store standard parameters, Session Manager, Run Command, basic CloudWatch metrics, the first 100 GB of monthly egress, and everything in the network stack.

**Two lines have no ceiling**, and neither triggers a resource alarm:

- **Surplus CPU credits.** A burstable instance in the default `unlimited` mode bills sustained CPU above its baseline instead of throttling it. Load that would show up as slowness on a fixed instance shows up as invoice here.
- **Egress past 100 GB**, per GB.

Container count does not affect cost. Two replicas cost what one costs, because the instance is the billed unit — which is the same reason container-level elasticity saves nothing.

## Testing it before it is real

The rendered configuration runs unchanged on any Docker host, which makes every layer testable without AWS. Render the templates from a scratch directory holding a copy of `templates/` and a `main.tf` with no backend block:

```bash
printf 'terraform { required_version = ">= 1.10" }\n' > main.tf
terraform init

printf 'jsonencode(templatefile("./templates/dynamic.yaml.tftpl", {rate_limit_average=20,rate_limit_burst=50,in_flight_limit=20}))\n' \
  | terraform console \
  | python3 -c 'import sys,json; sys.stdout.write(json.loads(json.loads(sys.stdin.read().strip())))'
```

Two details make this work. `terraform console` prints a multi-line string as a heredoc, so wrapping the call in `jsonencode` is what makes the output machine-readable; and it evaluates **one line at a time**, so a multi-line expression must be collapsed or moved into an `output` and read with `terraform output -raw`.

Then, in a directory holding the rendered `docker-compose.yaml`, `traefik.yaml` and `dynamic.yaml`, plus a `.env` naming a locally built image and an `app.env` with any `DATABASE_URL`:

```bash
docker compose up -d
```

`/health` does not touch the database, so the stack comes up healthy against an unreachable one.

### What each check proves

| Check                                                                 | Proves                                                          |
| --------------------------------------------------------------------- | --------------------------------------------------------------- |
| `curl localhost/health`                                               | routing and label discovery                                     |
| repeated 404s, then `docker compose logs traefik` filtered on `:4000` | requests are spread across replicas                             |
| 150 fast requests at once                                             | the rate limit throttles, and the bucket refills after a pause  |
| 25 slow uploads (`curl --limit-rate`), kept under the burst           | the in-flight limit fires exactly where the rate limit cannot   |
| bodies of 9 / 12 / 20 kB                                              | the application's limit and the proxy's backstop, in that order |
| `wget` at the socket proxy from inside the proxy container            | reads succeed, `POST /containers/create` is refused             |
| `getent hosts socket-proxy` from an application container             | the Docker API is unreachable from the application              |
| traffic through `docker stop` of one replica                          | the drain, the health check and the grace period agree          |

The last one is the check worth keeping. Run continuous requests against a **real endpoint** rather than `/health` — `/health` reports `503` while draining by design, so testing against it measures the drain working and looks like it failing. A clean result is every request answered, the container exiting with code `0`, and `Shutdown complete` in its log. Exit code `137` means `SIGKILL` arrived first and the grace period is too short.

### What this cannot cover

Rendering and running locally exercises the proxy, the limits, the labels and the shutdown path. It says nothing about IAM, the instance profile, cloud-init, the Elastic IP association, or whether user data fits the **16 kB limit EC2 imposes before base64 encoding** — which the rendered script approaches closely enough that compressing it is not an optimisation but a requirement. Cloud-init decompresses gzipped user data on its own, so the cost is only a plan diff that no longer shows the script.
