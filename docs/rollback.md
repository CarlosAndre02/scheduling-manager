# Rollback

Going back to the previous release, why it is one command, and the discipline that keeps it available. The release mechanism itself is in [ci-cd.md](ci-cd.md#deploying); this is about what a rollback can and cannot undo.

## A rollback is a name, not a rebuild

The running version is a value — the commit SHA, held in Parameter Store — and the instance asks for it rather than knowing it. So going back is the same operation as going forward, with an older value:

```bash
scripts/release.sh --list     # what can be released, and what was released
scripts/release.sh <sha>      # deploy, or roll back
```

There is no rollback build, no rollback branch and no rollback code path. That is the point: a separate mechanism would be one that nobody exercises until the worst possible moment, and every deploy exercises this one.

## Why it is fast, and what that costs

Three properties compound.

**A tag always names the same bytes.** The registry refuses a second push of an existing tag, so `:abc123` cannot mean something different than it did last week. A rollback is a lookup, never a rebuild — and a rebuild would be a different artifact than the one that was known to work, which is the opposite of what a rollback is for.

**The previous image is still on the host.** `docker image prune` removes only _dangling_ images, and immutable tags mean pulling a new release never orphans the previous one — it keeps its tag and survives the prune. So `docker compose pull` on a rollback finds everything locally and the registry is barely touched.

**The time is a container restart plus the health gate**, not a download. The same drain applies as on any deploy: the application answers `503` on `/health` while closing, the proxy takes it out of rotation, and the other replica absorbs the traffic — [ec2.md](ec2.md#draining-and-the-three-timeouts-that-have-to-agree).

**The cost is a disk that only grows.** Released images accumulate on the root volume, because none of them is ever dangling. Successive releases share every layer below the application's own, so each one adds what changed rather than the whole image, and the bound is distant — but nothing measures it and nothing prunes it.

The remedy is deliberately dangerous: `docker image prune -a` removes every image no container is using, which is precisely the set of rollback targets. Reclaiming space means choosing how far back the system can go, and it deserves to be that explicit.

## What bounds the window

| Bound                      | Set by                                 | Effect when crossed                                 |
| -------------------------- | -------------------------------------- | --------------------------------------------------- |
| `image_retention_count`    | the ECR lifecycle policy in `delivery` | the image is gone; that release can never run again |
| the instance's root volume | `root_volume_size` in `compute`        | pulling stops working before anything warns         |
| schema compatibility       | the migrations themselves              | the image runs and is wrong — see below             |

The first is the only one that is declared, and it is declared as a rollback window rather than as housekeeping. Lowering it below the number of releases anyone might need to reach is a decision about recoverability disguised as a storage setting.

## Finding what to go back to

**The parameter records intent, not reality.** After a failed deploy it names the release that failed, because it is written before the deploy runs — which is correct (a reboot mid-deploy should come up on the intended version) and misleading at exactly the wrong moment.

Two places hold the answer:

- **The failure output.** `scripts/release.sh` reads the outgoing tag before it writes the new one, and prints the command that reverses it when the deploy fails. Keeping that output is the cheapest path.
- **The parameter's history**, when the output is gone:

  ```bash
  aws ssm get-parameter-history --name /<project>/image-tag \
    --query 'reverse(Parameters)[:10].[Value,LastModifiedDate]' --output text
  ```

  This is what `release.sh --list` prints, and it is the only ordered record of what was released. Push order is not release order — a release can be skipped, and a rollback publishes nothing at all — so the registry listing answers a different question. The history is bounded by a Parameter Store limit rather than by anything set here.

`--list` is the one part of the script outside the CI role's permissions, by design: reading release history is an operator's task, and the pipeline has no reason to hold the grant.

## What a rollback does not undo

A rollback moves one value: the image tag. Everything that follows from that is reversed, and nothing else is.

| What                                                          | Reversed |
| ------------------------------------------------------------- | -------- |
| the image, and therefore the behaviour of the code            | yes      |
| the schema                                                    | no       |
| rows the newer release wrote or changed                       | no       |
| `app-replicas`, the database URL, every other parameter       | no       |
| what user data delivered — the proxy config, the Compose file | no       |

The fourth row is the one that turns a rollback from a fix into a partial fix. **A release that changed a parameter as well as the image needs both reversed**, and only one of them is versioned — the failure message names the image and knows nothing about the rest.

## The schema only moves forward

Rolling the app back to a previous image does **not** roll the schema back, and it must not: code is stateless, so replacing the image restores the previous behaviour exactly, while a database holds state. A down migration that drops a column does not undo anything — it destroys every value written there since.

So the schema only moves forward. What makes a rollback safe is an invariant instead:

> **The schema of release N has to work with the code of release N−1.**

This is the same guarantee Heroku offered, and it is worth being precise about how: `heroku rollback` restored a previous slug and its config, and never touched the database, which the platform documented plainly. Compatibility was not provided — it was a discipline the release model made cheap to keep. Migrations ran in a release phase that blocked the deploy when they failed, and the schema stayed where it was.

The pipeline here has the same shape, and stretches the window further: `migrate` runs on merge and the deploy waits for a person, so the old code runs against the new schema for as long as nobody deploys. The invariant is not introduced by that gap, only made harder to notice being wrong about.

## Expand and contract

Every schema change becomes up to three releases, each safe to roll back on its own:

1. **Expand** — additive only. A new nullable column, a new table, a new index. Old code ignores it; new code may use it.
2. **Backfill** — populate existing rows, and write to both places while both versions can run.
3. **Contract** — remove the old structure, in a later release, once rolling back past the expand is no longer a possibility.

Only the third step breaks a rollback, which is exactly why it is a separate deploy rather than the tail of the first.

| Direct change, breaks rollback | Expand and contract                                                    |
| ------------------------------ | ---------------------------------------------------------------------- |
| `RENAME COLUMN a TO b`         | add `b`, write both, backfill, drop `a` later                          |
| `ADD COLUMN c NOT NULL`        | add it nullable, backfill, apply the constraint afterwards             |
| `DROP COLUMN d`                | stop writing it, release, drop it in a later one                       |
| Change a column's type         | new column with the new type, write both, move reads, drop the old one |

**The dangerous case is not in the table.** Changing the _format_ of values inside a column the old code still reads produces no error at all — the previous release parses the new format as if it were the old one and is quietly wrong. A format change needs a new column, exactly like a type change.

**Contract is a decision about the window, not a cleanup.** Once the third step ships, every release before the expand becomes unreachable regardless of what the registry still holds. Deferring it until those releases have aged out of `image_retention_count` costs nothing and means the two bounds never contradict each other.

## Techniques that keep the window open

**Keep releases small.** The invariant is between consecutive releases, so the cost of holding it grows with how much each one changes. A release that touches the schema and nothing else is trivially reversible; one that batches a month of work has to be compatible with a version far behind it.

**Never pair a schema change with a config change.** Only the image tag rolls back, so a release that also moved a parameter has a second, manual step on the way out — and that step is not in any failure message.

**Separate deploying from enabling.** Behaviour behind a flag makes the way back a flag flip rather than a release, which is faster and does not touch the schema at all. Nothing here provides that, so it is a design option rather than an available tool — worth reaching for when a change is risky enough that a release-shaped rollback is too slow.

**Write the reverse before shipping the forward.** Not as a down migration — as the answer to "which SHA, and what else has to move". A rollback plan that is written during the incident is written badly.

## Proving the invariant

The rule above is only worth as much as its enforcement, and it is mechanically checkable: apply the migrations from the change onto a clean database, then run the **previous release's** test suite against that schema. If the old tests pass, the old code runs on the new schema, which is the whole claim.

Two things never provide this guarantee. Down migrations are a local convenience and should not be run against real data. Point-in-time recovery restores to a new instance and discards everything after the chosen moment, which makes it a disaster tool rather than a rollback — see [rds.md](rds.md#backups-and-what-point-in-time-recovery-is-not).

## When a rollback is the wrong tool

**A destructive migration has already run.** Nothing in the release mechanism reaches it; recovery is a restore, which loses everything written since the chosen moment and is a different decision with a different blast radius.

**The fault is in the data, not the code.** Every release behaves identically on a bad row, so going back changes nothing and costs a deploy.

**The fault is outside the release.** An unreachable database, an exhausted pooler and a saturated instance fail every image equally. This is why the deploy does not revert on its own: the health gate cannot distinguish "this release is broken" from "nothing would work right now", and a machine that flips between two good releases has hidden the actual fault rather than fixed it.
