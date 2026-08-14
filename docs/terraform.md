# Terraform

Infrastructure lives under `infra/terraform/<stack>/`, one directory per stack, each owning its own state. Every stack carries a README with its runbook; this page is the tool itself.

## The model

Each run compares three things:

| Source              | Meaning                            |
| ------------------- | ---------------------------------- |
| `*.tf`              | what you want to exist             |
| `terraform.tfstate` | what Terraform believes it created |
| the provider API    | what actually exists               |

`plan` reports the differences, `apply` closes them. You never write "create a budget" — you write "a budget like this exists", and Terraform decides whether that means create, update, or nothing at all.

Two consequences follow directly:

- **Applying twice changes nothing.** A second run reports `No changes`. This is the difference from a provisioning script, which would create a second budget.
- **Manual console edits are undone.** A change made outside Terraform shows up in `plan` as drift, and `apply` restores what the files say. The files are the source of truth, or nothing is.

Resources are applied one at a time and state records each success, so a failed `apply` leaves the resources that already succeeded in place. Fixing the cause and re-running continues from there rather than starting over.

## It is not a migration system

This repository holds both models, and confusing them is the most expensive mistake available:

|                     | Drizzle migrations    | Terraform              |
| ------------------- | --------------------- | ---------------------- |
| Describes           | a sequence of changes | the desired end state  |
| History lives in    | numbered SQL files    | git                    |
| To change something | add a new file        | edit the existing file |

Adding `alerts-v2.tf` alongside `alerts.tf` produces a _second_ set of resources, not a modification of the first.

## Replacement and renames

`plan` output is worth reading in full, because not every change is harmless:

- `~` updates in place.
- `-/+ destroy and then create replacement` means the attribute is immutable in the provider API. Acceptable for a budget; not for a database.
- **Renaming a resource's Terraform address destroys and recreates it.** State is keyed by the address, so `aws_budgets_budget.ceiling` → `.limit` reads as "delete that one, create this one". A `moved` block renames without touching the resource.

## State

State is a plain JSON file mapping each address to a real resource. Losing it makes Terraform forget everything it created and try to create it again.

It lives either next to the code (**local**) or in a bucket with a lock (**remote**). Remote is the default answer for a team, but there is a bootstrapping order to respect: the bucket is itself infrastructure, so the first stack cannot use a backend that does not yet exist.

Local state is defensible while all of these hold — and a stack that outgrows any of them needs a remote backend:

- one person applying, so concurrent runs are impossible
- nothing sensitive in the state, since it is stored unencrypted
- every resource cheap to recreate by hand if the file is lost

That last point is what makes stateful resources the dividing line. Losing the state of a budget means recreating a budget; losing the state of a database means Terraform proposing to replace it.

The same test is what keeps one stack on local state permanently: the one whose only job is to create the bucket the others use — see [aws-stack-implementation.md](aws-stack-implementation.md#the-bootstrap-paradox).

### A backend block takes no variables

Unlike everything else in a configuration, a `backend` block is read before variables exist, so it accepts no `var.`, no interpolation and no data source. Every value in it must be a literal.

That matters when a value should not be committed — a bucket name carrying an AWS account id, in a public repository. The escape is a **partial configuration**: leave the value out of the block and supply it at init time, from a file kept out of git.

```hcl
backend "s3" {
  key          = "<stack>/terraform.tfstate"   # committed, not sensitive
  encrypt      = true
  use_lockfile = true                          # native S3 locking, 1.10 and later
}
```

```bash
terraform init -backend-config=../backend.hcl   # supplies bucket and region
```

Omitting the flag does not fail silently — Terraform prompts for the missing values interactively.

**Changing a backend requires `-migrate-state`.** Terraform will not move state on its own: it detects that the configured backend differs from the recorded one, and asks before copying. The check afterwards is a `plan` reporting **no changes**, which proves the state arrived — an empty state at the destination shows up as a plan proposing to create everything the stack already owns.

**Committed:** `*.tf`, `terraform.tfvars.example`, `backend.hcl.example`, and `.terraform.lock.hcl` — the lock pins provider versions the way `package-lock.json` pins npm ones, so it belongs in git.
**Ignored:** `terraform.tfvars` (per-account values), `backend.hcl` (carries the account id), `*.tfstate`, `.terraform/`.

## Import

`import` adopts a resource that already exists into state, instead of creating it. Needed whenever something exists outside Terraform and cannot be created a second time — a resource the provider auto-creates, or one already made by hand.

```bash
terraform import <resource_address> <id>
```

The alternative is a data source, which reads an existing resource without owning it. Not every resource has one, and an id containing a generated UUID cannot be reconstructed from other values, which is exactly when import is the only route.

After importing, `plan` shows the difference between the adopted resource and the configuration. Accept it or edit the configuration to match — either is fine, as long as the two agree before moving on.

## Running it

From the terminal, by hand. Automation solves concurrent applies and an audit trail of who applied what, neither of which exists with one operator and a stack that changes a few times a year. When application infrastructure arrives, that calculation changes.

```bash
terraform init -backend-config=../backend.hcl   # providers, lock file, backend
terraform validate                              # syntax and types, no API calls
terraform plan                                  # read the whole output
terraform apply
```

`fmt` is the formatter, equivalent to Prettier for the rest of the repository.

Each step catches a different class of error, and only the last one is subject to what the service actually enforces:

| Step       | Catches                                                                  |
| ---------- | ------------------------------------------------------------------------ |
| `validate` | syntax, types, and whether an argument exists in the provider's schema   |
| `plan`     | what would change, comparing the configuration against state and the API |
| `apply`    | everything a service only checks at write time                           |

The third row is the one that surprises, because it looks like a class of error the first two should have caught. A name already taken, a quota, a limit on how many of something an account may hold, a value outside a set the schema does not describe — all of these are valid configuration until the API rejects them. A security group rule description, for instance, accepts only `a-zA-Z0-9. _-:/()#,@[]+=&;{}!$*`, and nothing before `apply` knows that.

A failure there is not a rollback. State records each resource as it succeeds, so the fix is to correct the cause and run again, and the plan will be whatever remains.

The `-backend-config` flag is what supplies the values the backend block cannot hold, so it is needed on every `init` — not only the first. The one stack that omits it is the one holding local state.

## Provider regions

The provider's `region` is where API calls go, not where the code lives. Global services (IAM, Budgets, Cost Explorer) are reached through `us-east-1` regardless of where workloads run, so a stack targeting one of them pins `us-east-1` and says nothing about the rest of the account.
