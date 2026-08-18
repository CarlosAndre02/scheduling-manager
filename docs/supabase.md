# Supabase as the database

Supabase provides the PostgreSQL this application uses. It is Postgres, so the schema, the migrations, Drizzle and every query are unchanged from any other provider — what differs is how the connection is reached, how it is secured, and which parts of the AWS infrastructure stop having a purpose.

Why a managed database at all, and what one costs to run properly, is in [rds.md](rds.md); that page's [requirements](rds.md#what-connecting-to-a-managed-instance-requires) apply here too, because they come from the driver and the network rather than from AWS.

## The connection endpoint is not a free choice

Supabase exposes the same database three ways, and two of them are wrong for this application.

| Endpoint                        | Port | Address family |
| ------------------------------- | ---- | -------------- |
| Direct (`db.<ref>.supabase.co`) | 5432 | **IPv6 only**  |
| Supavisor, session mode         | 5432 | IPv4           |
| Supavisor, transaction mode     | 6543 | IPv4           |

**The direct endpoint is unreachable from this VPC.** Supabase gave up dedicated IPv4 addresses because AWS began charging for them, so the direct hostname resolves to IPv6 only — and the VPC has no IPv6 block. The failure is `ENETUNREACH` at the network layer, which reads like a firewall or credential problem and is neither. Reaching it would mean either the paid IPv4 add-on, or adding IPv6 to the VPC and writing a second set of security group rules, since a rule declared with `cidr_ipv4` does not cover IPv6 traffic at all ([vpc.md](vpc.md#security-groups)).

**Transaction mode breaks two things this project relies on.** It multiplexes many clients onto few server connections, releasing the connection at the end of each transaction, so nothing that lives in a session survives:

- The migration runner takes a `pg_try_advisory_lock`, and an advisory lock is held by a **session**. Through a transaction pooler the connection underneath can change between taking the lock and releasing it, so the protection against concurrent migrations stops working without failing — the worst way for a lock to break.
- The application already pools in process (`max` connections per container). A transaction pooler exists to give connection reuse to workloads that cannot pool — serverless functions opening a connection per invocation. Stacking it under an application pool adds a component without removing a problem.

**Session mode is the endpoint to use.** It behaves like a direct connection, over IPv4.

## TLS has to be configured in code

Supabase requires TLS, and the connection string it hands out carries `?sslmode=require`. Using it as given is the mistake, for a reason specific to the driver.

`pg` does not merge the connection string with the `ssl` option — the string **replaces** it:

| Configuration                                      | Resulting `ssl`                |
| -------------------------------------------------- | ------------------------------ |
| URL without `sslmode`, plus `ssl: { ca }`          | `{ ca }`                       |
| URL with `sslmode=verify-full`, plus `ssl: { ca }` | `{}` — the CA is **discarded** |

So a URL carrying any `sslmode` silently throws away the certificate authority, and verification falls back to Node's default trust store. The error that follows names the certificate, never the configuration that dropped it.

[conn.ts](../src/shared/database/conn.ts) therefore configures TLS itself and `DATABASE_URL` carries no `sslmode`:

| Variable            | Effect                                                      |
| ------------------- | ----------------------------------------------------------- |
| `DATABASE_SSL_CA`   | path to a CA bundle; the certificate is verified against it |
| `DATABASE_SSL=true` | TLS verified against Node's default trust store             |
| neither             | no TLS — which is what local Postgres speaks                |

`DATABASE_SSL=true` is not enough here. Supabase presents a chain ending in its own self-signed root, which is not in Node's default trust store, so verification against that store fails with `self-signed certificate in certificate chain`. The alternative — disabling verification — would encrypt the connection while leaving the client unable to tell the real server from an impostor, which is the half of TLS that matters on a public endpoint. So `DATABASE_SSL_CA` is the production setting, and pointing it at a missing file fails at startup rather than on the first query, deliberately.

Keeping `sslmode` out of the URL has a second effect worth knowing: `pg` 9 will change what `require` means, from "verify the server" to "encrypt without verifying". A configuration that never mentions `sslmode` is not exposed to that change.

### Where the certificate lives

Inside the image, at `/app/certs/`, from [certs/](../certs) in this repository — which is also where the rationale sits. Two consumers need it and both run that image: the container the pipeline runs migrations from, and the application on the host. One copy, one path, one thing to rotate.

The alternatives were considered and rejected for concrete reasons. Downloading it at boot puts a network fetch on the startup path, so a provider's website being unreachable becomes an instance that comes up unable to connect. Keeping it in Parameter Store would force the migration job to hold AWS credentials, when the point of separating that job from publishing is that it holds database credentials and nothing else. A certificate authority is public material — it is what lets a client recognise a server, not what lets anyone reach one — so there is nothing to protect by keeping it out of git.

Nothing in the Dockerfile points `DATABASE_SSL_CA` at it. The file travels with the image; naming it stays an environment decision, so the same image run against a plaintext database does not try to negotiate TLS.

**Enable "Enforce SSL on incoming connections" in the Supabase dashboard**, and treat it as a separate control rather than a duplicate of the above. Server enforcement stops a client from connecting in the clear; client verification stops a client from trusting the wrong server. Neither substitutes for the other, and the enforcement is the one that turns a misconfigured client into a loud failure instead of a silent plaintext session over the public internet.

## What the schedule of a free project does

A free Supabase project **pauses after roughly a week without activity** and has to be restored by hand. That is workable for development and is the same availability trade as a database on a timer ([aws-governance.md](aws-governance.md#running-only-during-the-hours-in-use)): fine when the people using it have working hours, an outage when anyone else can arrive.

The paid tier removes the pause. It is worth comparing honestly against the option it replaced: it costs more per month than the smallest RDS instance this project set aside on cost grounds. The comparison only favours it when Auth, Storage or Realtime are also in use — paying for a managed Postgres alone is paying for a platform that mostly goes unused.

## What changes about security

The database moves from _unreachable_ to _reachable and authenticated_. With RDS in a private subnet, an attacker with valid credentials still had no route; with Supabase the endpoint is on the public internet and the password is the boundary.

Two things follow:

- **The credential matters more than it did.** It is the whole control, so it belongs in a secret store injected at container start, never in an image or a repository.
- **An IP allowlist is the compensating control**, and this architecture can actually use one: the instance holds an Elastic IP, so its egress address is stable and known. Supabase offers network restrictions on paid plans.

## What stops having a purpose in AWS

Two resources in the `network` stack existed for a database inside the VPC:

- **`sg_db`** has no member and no consumer. The security group chain that made the database reachable only from the application describes nothing now.
- **The private subnets** were created because an RDS subnet group demands two availability zones. They cost nothing and stay useful for anything private that arrives later, so removing them buys nothing — but the reason they exist has changed, which matters the next time someone reads the stack and looks for what is in them.

The `database` stack described in [rds.md](rds.md#a-sketch-of-the-database-stack) is not built. What replaces it is a connection string in a secret store, and nothing in Terraform.

## What migrations gain

The reason migrations could not run from CI was that the database sat in a private subnet no runner could reach. Supabase is on the public internet, so that constraint is gone and the migration step can move into the pipeline instead of being driven onto the host.

That is a simplification with a price: the pipeline then holds database credentials, which widens what a compromised workflow reaches. The step keeps its two other properties either way — it runs before the new code serves traffic, and a failure stops the rollout.

One detail carries over unchanged: **migrations must run with the statement timeout disabled.** The application sets one so a stuck query cannot hold a connection forever, and DDL against a populated table can legitimately exceed any value that makes sense for a request:

```bash
docker run --rm -e DATABASE_STATEMENT_TIMEOUT_MS=0 <image> node dist/shared/database/migrate.js
```

Backward compatibility between the schema and the previous release is unaffected by the change of provider — see [api.md](api.md#rollback-and-schema-compatibility).
