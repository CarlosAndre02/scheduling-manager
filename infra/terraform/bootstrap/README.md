# Bootstrap stack

The S3 bucket every other stack keeps its Terraform state in. [docs/aws-stack-implementation.md](../../../docs/aws-stack-implementation.md#state-backend) explains why the backend moves off local disk, and [docs/terraform.md](../../../docs/terraform.md) covers what state is.

This is the one stack whose own state stays local, permanently: a bucket cannot store the state that describes it.

## What it creates

| Resource                         | Effect                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| S3 bucket `tfstate-<account-id>` | state destination: private, SSE-S3, versioned, `prevent_destroy`                            |
| Versioning                       | every apply supersedes rather than overwrites, so a bad state can be rolled back            |
| Lifecycle rule                   | drops superseded versions after `state_retention_days`, and stale multipart uploads after 7 |
| Bucket policy                    | denies any non-TLS request                                                                  |

**Cost: cents a month.** State files are kilobytes. There is no DynamoDB table — locking is native to the S3 backend from Terraform 1.10 on.

**No Object Lock**, unlike the audit bucket. Terraform rewrites the state object on every apply, and a retention lock would make the second apply fail.

## Prerequisites

`terraform` 1.10 or newer — `use_lockfile` does not exist before it — plus `awscli` on `PATH` and credentials with `AdministratorAccess`. Confirm with `aws sts get-caller-identity`.

Nothing has to be enabled in the console first.

## Running

```bash
terraform init
terraform validate
terraform plan
terraform apply
```

Every variable has a default, so `terraform.tfvars` is only needed to override one.

Then write the shared backend settings the other stacks read:

```bash
terraform output -raw backend_hcl > ../backend.hcl
```

That file is **not committed**. A `backend` block accepts no variables and no interpolation, so the bucket name has to be a literal somewhere — and it carries the account id, which does not belong in a public repository. Keeping it in one gitignored file passed at init time is the way to have both.

## Moving a stack onto the backend

A stack still holding its state on local disk moves in one command, once it declares the backend. Do one stack at a time and confirm each before starting the next — the confirmation below is the whole point of going slowly.

```bash
cd ../billing
terraform init -backend-config=../backend.hcl -migrate-state
```

Terraform detects the local state, prints the backend it is moving to, and asks for confirmation — answer `yes`. It copies the state up; it does not delete the local copy.

Confirm the move landed:

```bash
terraform plan     # expect: No changes
```

**`No changes` is the whole test.** It proves the state arrived intact: if the copy had failed or gone to the wrong key, Terraform would find an empty state and propose creating every resource in the stack from scratch. A plan that proposes creating things you know already exist means stop and investigate — do not apply it.

Once the plan is clean, the local files are dead weight and can go:

```bash
rm terraform.tfstate terraform.tfstate.backup
```

Repeat for every other stack. From then on, `terraform init` anywhere needs the same flag:

```bash
terraform init -backend-config=../backend.hcl
```

## Managing it

**Recover a bad state.** This is what versioning is for, and the reason it is not optional:

```bash
aws s3api list-object-versions --bucket <bucket> --prefix billing/terraform.tfstate \
  --query 'Versions[].[VersionId,LastModified]' --output table
aws s3api get-object --bucket <bucket> --key billing/terraform.tfstate \
  --version-id <id> terraform.tfstate
terraform state push terraform.tfstate
```

**A stuck lock.** A run killed mid-apply leaves the lock object behind and the next run refuses to start. Terraform prints the lock id; release it only after confirming no apply is actually running, because breaking a live lock is how two runs corrupt one state:

```bash
terraform force-unlock <lock-id>
```

**Adding a stack.** Give it a `backend "s3"` block with its own `key`, and never reuse a key — two stacks pointing at one object silently overwrite each other:

```hcl
backend "s3" {
  key          = "<stack>/terraform.tfstate"
  encrypt      = true
  use_lockfile = true
}
```

**Tearing it down is deliberately hard.** `prevent_destroy` makes `terraform destroy` fail, and removing the bucket while other stacks still reference it makes them forget everything they created. Emptying it requires deleting every version, not just the current ones — [scripts/purge-bucket.sh](../../../scripts/purge-bucket.sh) does that, and defaults to counting rather than deleting.
