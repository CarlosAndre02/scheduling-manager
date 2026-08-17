# Managed PostgreSQL on AWS

Amazon RDS is not part of this infrastructure. The reasoning is below, together with what running it well would require — so that the decision can be revisited against facts rather than re-derived.

Most of [what a managed instance requires](#what-connecting-to-a-managed-instance-requires) is not specific to RDS. Any hosted Postgres reached over the network — Supabase, Neon, a Postgres on another host — imposes the same requirements on the application, so that section stays useful whichever way the database is provided.

## The decision

RDS is set aside for cost and complexity, in that order.

**Cost.** The smallest current-generation instance plus its storage lands near US$14 a month before backups, and it bills by the hour whether or not a request arrives. Against an infrastructure budget of a few tens of dollars, the database becomes the largest single line — and every other stack in this project was built to cost nothing until something runs.

**Complexity.** RDS is cheap to create and expensive to operate correctly. Roughly half of this page describes settings that cannot be changed after creation or that silently disable recovery, and each one is a way to end up with a database that looks fine until it matters.

**What would reverse it:** paying users, a recovery objective that a snapshot cannot meet, or a compliance requirement for encryption and point-in-time recovery that has to be demonstrable rather than asserted. At that point the cost stops being the largest line on the invoice and starts being cheaper than the alternative.

## What "managed" buys and what it costs

AWS operates the host: engine and operating system patching, automated backups, failover, storage growth, and metrics. What stays with the application is the schema, the queries, the connection pool and the migration discipline.

What is given up is real superuser access. The master user holds the `rds_superuser` role, not `superuser`, which means some extensions are unavailable, `COPY FROM PROGRAM` does not run, and engine configuration happens through parameter groups rather than `postgresql.conf`.

The alternative of running Postgres in a container beside the application is cheaper and worse for anything with users: backups, point-in-time recovery, failover and patching all become the operator's problem, and the disk dies with the instance — which contradicts treating the compute host as disposable ([aws-stack-implementation.md](aws-stack-implementation.md#keeping-compute-disposable)).

## Settings that cannot be fixed later

These belong in the first apply, because correcting them afterwards means a snapshot, a restore and a new endpoint.

| Setting                               | Why it is one-way                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `storage_encrypted = true`            | Encryption cannot be enabled on an existing instance. It is free, and it is asked for in every security review |
| `backup_retention_period` above zero  | This is what enables point-in-time recovery. At zero there is no PITR, and no way to obtain it retroactively   |
| The engine major version              | Upgrading is possible; downgrading is not                                                                      |
| The subnet group's availability zones | It must span two AZs even for a Single-AZ instance, and changing it later touches a live database              |

Three more that are reversible but decide whether a mistake is survivable:

- **`deletion_protection = true`** and **`skip_final_snapshot = false`** with a named final snapshot. The database is the one thing in the system that cannot be rebuilt from this repository.
- **`max_allocated_storage`**, which caps storage autoscaling. It is one of the few genuinely rigid cost ceilings AWS offers — without it, growth is unbounded and so is the bill.
- **`manage_master_user_password = true`**, which has RDS generate and rotate the password in Secrets Manager. The Terraform state then holds the secret's ARN rather than the password itself, which removes the main reason that state has to be treated as sensitive. It costs about US$0.40 a month for the secret, and requires the workload to hold `secretsmanager:GetSecretValue` and `kms:Decrypt` to read it at runtime.

## Where migrations run

Three placements are possible and two are wrong.

**From CI, before the deploy.** The instance is not reachable: it lives in a private subnet, and a GitHub-hosted runner is not in the VPC. Making it work means a publicly reachable database, a self-hosted runner, or a tunnel — each worse than the alternative.

**From the application container's entrypoint.** This couples "change the schema" to "start serving". A failed migration becomes a crash loop, and the cause is buried in application logs rather than reported as a failed step.

**As a discrete step in the deploy**, which is the right answer:

```bash
docker run --rm <image> node dist/shared/database/migrate.js   # a failure stops the rollout here
# only then: replace the running container
```

The migration gets its own success or failure, and the rollout proceeds only if it passed. This is the shape Heroku's release phase had, for the same reason.

[src/shared/database/migrate.ts](../src/shared/database/migrate.ts) already takes a `pg_try_advisory_lock` before applying, so two runners cannot apply concurrently. With a single host that is redundant; it stops being redundant the moment a deploy overlaps two instances.

## Backups, and what point-in-time recovery is not

Automated backups plus archived transaction logs allow restoring to any second inside the retention window. Two properties decide how it can be used:

- **A restore creates a new instance**, with a new endpoint. Nothing is restored in place, so the application has to be repointed.
- **Everything after the chosen point is discarded.** There is no way to keep writes that happened after the moment being restored to.

That makes PITR a disaster tool — corruption, a mistaken bulk delete, a dropped table — and **not a rollback mechanism**. A deploy that has to be undone is undone by redeploying the previous image, never by restoring the database. Planning a rollback strategy around PITR is planning to lose data.

## What connecting to a managed instance requires

The application connects through [src/shared/database/conn.ts](../src/shared/database/conn.ts), which builds a `pg` pool from `DATABASE_URL`. The requirements below apply to any managed Postgres, not only RDS.

### TLS, and a driver behaviour worth knowing

A managed instance either requires TLS or should be configured to (`rds.force_ssl = 1` in an RDS parameter group). The pool is built from the connection string alone, and **`pg` enables TLS only when the URL asks for it** — with no `sslmode`, the connection is plaintext and a server that requires TLS refuses it.

How `pg` 8 interprets the parameter is not what libpq does, and it is changing:

| `sslmode` in the URL | What `pg` 8 does               |
| -------------------- | ------------------------------ |
| absent               | no TLS at all                  |
| `require`            | TLS **with full verification** |
| `verify-full`        | TLS with full verification     |
| `no-verify`          | TLS, certificate not checked   |

`pg` emits a deprecation warning about this: `prefer`, `require` and `verify-ca` are currently aliases for `verify-full`, and in `pg` 9 they will adopt libpq semantics, where `require` encrypts **without verifying the server**. Writing `sslmode=require` therefore means "verify" today and "do not verify" after a major upgrade — a silent weakening at a version bump. **Write `sslmode=verify-full` explicitly**, which means the same thing before and after.

Verification then needs a certificate authority the client trusts. RDS certificates do not chain to a CA in Node's default trust store, so the RDS CA bundle has to be shipped in the image and passed as `ssl.ca` — a connection string alone cannot express it, so this is a change to `conn.ts` rather than to configuration.

### Everything else the connection needs

- **The credential has to arrive from somewhere.** `DATABASE_URL` is read from the environment, and `dotenv` finds no `.env` inside the image — which is correct, but means the value must be injected at container start from Secrets Manager or Parameter Store.
- **A missing variable fails late and obscurely.** `process.env.DATABASE_URL!` asserts a value that nothing checks, so an unset variable surfaces as a driver error on the first query rather than as a refusal to start. Validating required environment at boot turns a confusing runtime failure into an immediate one.
- **`/health` does not touch the database.** It reports the process's own state, so it answers `200` while the database is unreachable — which means a deploy gated on it would report success over a broken release. A health check that a rollout depends on has to test the dependency the release actually needs.
- **No statement timeout is set.** A query that never returns holds its pool connection indefinitely, and enough of them exhaust the pool. `statement_timeout` and `query_timeout` belong in the pool configuration, sized above the slowest legitimate query.
- **Pool size has to be read against the instance, not the container.** `max_connections` on a small instance is derived from its memory and is easily exhausted: the ceiling is `DATABASE_POOL_MAX` multiplied by the number of containers, plus migration and administrative connections. A pool default that is fine for one container is not fine for six.

Already handled, and worth not undoing: the pool has an `error` listener, so a connection dropped during a failover does not become an uncaught exception that kills the process; and `keepAliveTimeout` is set above a load balancer's idle timeout, so a reused connection does not produce sporadic `502`s.

## Cost

| Item                                              | Approximate, us-east-1      |
| ------------------------------------------------- | --------------------------- |
| `db.t4g.micro`, Single-AZ                         | US$12 / month               |
| 20 GB gp3 storage                                 | US$2 / month                |
| Backups up to the size of the database            | free                        |
| Secrets Manager, if the password is managed there | US$0.40 / month             |
| Multi-AZ                                          | roughly double the instance |

Storage is billed for what is allocated, not what is used, and it can only grow — RDS does not shrink allocated storage, so an oversized initial allocation is a permanent cost.

### Paying only for the hours in use

Billing by the hour is not billing by use: an instance is charged for every hour it _exists_, whether or not a query arrives. Two mechanisms change that, and storage is billed in full under both — which is the right expectation. The scheduling mechanism, what it does and does not save, and when it is appropriate at all are in [aws-governance.md](aws-governance.md#running-only-during-the-hours-in-use); what follows is what differs for a database.

**Stopping the instance.** Storage and backups are still billed, instance hours are not. For a database in use five hours a day that is roughly 150 hours instead of 730:

|                               | 24/7      | ~5 h/day   |
| ----------------------------- | --------- | ---------- |
| `db.t4g.micro` instance hours | US$12     | US$2.5     |
| 20 GB gp3 storage             | US$2      | US$2       |
| **Total**                     | **US$14** | **US$4.5** |

Two constraints have no equivalent on EC2. **RDS starts a stopped instance again after seven days**, so a schedule that only stops it loses the saving without saying anything. And **an instance must be available to be modified**, so a `terraform apply` that lands inside the off window fails until it is started — which makes the schedule something infrastructure changes have to be planned around.

**Aurora Serverless v2 scaled to zero** is the other route, and it is genuinely usage-based rather than schedule-based: capacity is billed per ACU-hour and a minimum of zero lets the cluster pause after an idle period, leaving only storage. It costs more to reason about. Aurora is a different cluster model from RDS PostgreSQL, storage and I/O are priced separately, and resuming takes on the order of fifteen seconds — during which connections wait or fail, so any client that treats a slow first connection as an outage will report one.

## A sketch of the `database` stack

What the stack would contain if the decision reversed, written out so the estimate above has something behind it. It follows the same shape as the stacks that exist: its own state, its own runbook, values from `network` found by tag rather than read out of another state file.

### The stack itself

```hcl
# Found by tag, not read from the network stack's state — the tags are the
# interface, and they already exist.
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

data "aws_security_group" "db" {
  filter {
    name   = "tag:Name"
    values = ["${var.project}-db"]
  }
}

# Two AZs are demanded here even though the instance is Single-AZ: the group
# declares where a failover could place it.
resource "aws_db_subnet_group" "main" {
  name       = var.project
  subnet_ids = data.aws_subnets.private.ids
}

resource "aws_db_parameter_group" "main" {
  name   = var.project
  family = "postgres${split(".", var.engine_version)[0]}"

  # Refuses any connection that is not over TLS, which is what makes the
  # client-side setting non-optional rather than advisory.
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  # Slow queries in the log, without logging every statement.
  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }
}

resource "aws_db_instance" "main" {
  identifier     = var.project
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  # Allocated storage is billed whole and can only grow, so it starts small.
  # max_allocated_storage is the ceiling autoscaling may not cross — one of the
  # few hard cost caps AWS offers.
  allocated_storage     = 20
  max_allocated_storage = var.max_storage_gb
  storage_type          = "gp3"
  storage_encrypted     = true # cannot be turned on later

  db_name  = var.database_name
  username = var.master_username

  # RDS generates and rotates the password in Secrets Manager. The state then
  # holds the secret's ARN and never the password.
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [data.aws_security_group.db.id]
  parameter_group_name   = aws_db_parameter_group.main.name
  publicly_accessible    = false
  multi_az               = false

  # Above zero is what enables point-in-time recovery. The two windows must not
  # overlap, and both are stated so AWS does not choose them.
  backup_retention_period = 7
  backup_window           = "06:00-07:00"
  maintenance_window      = "sun:07:30-sun:08:30"
  copy_tags_to_snapshot   = true

  auto_minor_version_upgrade = true

  performance_insights_enabled          = true
  performance_insights_retention_period = 7 # the free tier

  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.project}-final"

  lifecycle {
    prevent_destroy = true
  }
}
```

Four details in there are easy to get wrong:

- **`final_snapshot_identifier` must be a constant.** Deriving it from `timestamp()` makes every `plan` show a change. A fixed name means a second destroy collides with the snapshot the first one left, which is a good reason to pause.
- **`apply_immediately` is left at `false`.** Changes that require a restart wait for the maintenance window instead of interrupting service the moment someone runs `apply`.
- **`enabled_cloudwatch_logs_exports` is deliberately absent.** Exporting the Postgres log is useful and is billed by ingestion volume; `log_min_duration_statement` keeps the log small enough to be worth exporting if that changes.
- **`prevent_destroy` and `deletion_protection` are not the same thing.** The first stops Terraform proposing it; the second stops the AWS API accepting it, including from the console.

### What changes outside this stack

**The compute stack gains two permissions** — `secretsmanager:GetSecretValue` on the one secret ARN and `kms:Decrypt` on the key that encrypts it. Without the second, the first fails with a message that does not mention KMS.

**Something has to turn the secret into a connection.** The secret holds a username and a password as JSON, not a URL. Three ways out, in order of preference: have the container's entrypoint read the secret and compose `DATABASE_URL`; let `pg` read `PGHOST`/`PGUSER`/`PGPASSWORD` itself, which it does natively but which [conn.ts](../src/shared/database/conn.ts) currently overrides by passing `connectionString`; or store a composed URL in Parameter Store, which creates a second copy that rotation will not update.

**Rotation has to be survivable.** A password rotated in Secrets Manager invalidates a connection string read once at boot. Either the credential is read when a connection is made, or a rotation is followed by a restart — deciding this after the first rotation means discovering it as an outage.

**The application changes** listed in [what connecting requires](#what-connecting-to-a-managed-instance-requires): TLS with an explicit `verify-full` and the CA bundle, environment validation at boot, a statement timeout, a health check that touches the database, and a pool size read against the instance's connection limit.

**The deploy gains a step**, running the migration container before replacing the application container, so a failed migration stops the rollout rather than producing a half-deployed release.

**The spending thresholds move.** This is the first always-on cost in the project, and the budget that alerts on the first cent stops being a tripwire and becomes noise the day it exists — see [aws-governance.md](aws-governance.md#cost-guardrails).
