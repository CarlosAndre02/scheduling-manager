# Delivery stack

Everything needed for an image to leave GitHub and arrive in AWS, and nothing else. [docs/ci-cd.md](../../../docs/ci-cd.md#authenticating-to-aws) explains why the pipeline authenticates the way it does; this is the runbook.

The scope is deliberate. This is the only stack a compromised CI credential can reach, so the database and the network are outside its boundary — see [docs/aws-stack-implementation.md](../../../docs/aws-stack-implementation.md#the-stacks).

## What it creates

| Resource          | Effect                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------- |
| ECR repository    | image destination, with **immutable tags** and scan-on-push                            |
| Lifecycle policy  | expires untagged images after `untagged_retention_days`, keeps `image_retention_count` |
| OIDC provider     | trust anchor for GitHub's token issuer                                                 |
| IAM role + policy | assumable only by one repository and branch; may push to this one repository           |

**Cost: cents.** ECR storage is billed per GB and layers are shared between images, so successive builds of the same base add little. Pulling from the registry into the same region is free. The OIDC provider and the role cost nothing.

## Immutable tags change how deploys work

The registry refuses a second push of a tag that already exists. A tag therefore always names the same bytes, which is what makes a rollback a lookup rather than a rebuild.

The consequence to plan around: **a moving `latest` cannot exist here**, because the setting is repository-wide. Which image is deployed has to be recorded by the deploy — a task definition, a release file on the instance — and never by a tag that moves underneath it. That is the property that makes a release reproducible, not a limitation to work around.

A re-run of a workflow on an already-published commit will therefore fail to push. That is correct behaviour: the image for that commit already exists and is the one to deploy.

## Prerequisites

The same local setup as the other stacks: `terraform` 1.10 or newer and `awscli` on `PATH`, with credentials carrying `AdministratorAccess`. Confirm with `aws sts get-caller-identity`.

The [bootstrap](../bootstrap) stack has to be applied first, since its bucket is where this stack's state lives.

## Running

```bash
cp terraform.tfvars.example terraform.tfvars   # set github_repository
terraform init -backend-config=../backend.hcl
terraform validate
terraform plan
terraform apply
```

**If the account already has a GitHub OIDC provider**, apply fails with `EntityAlreadyExists`. An account holds at most one provider per URL, so the existing one is adopted rather than created:

```bash
aws iam list-open-id-connect-providers
terraform import aws_iam_openid_connect_provider.github <arn>
terraform apply
```

Confirm the result:

```bash
# Tags cannot be overwritten, and images are scanned on arrival
aws ecr describe-repositories --repository-names "$(terraform output -raw repository_url | cut -d/ -f2)" \
  --query 'repositories[0].{Mutability:imageTagMutability,ScanOnPush:imageScanningConfiguration.scanOnPush}' \
  --output table

# Both lifecycle rules, in priority order
aws ecr get-lifecycle-policy --repository-name "$(terraform output -raw repository_url | cut -d/ -f2)" \
  --query 'lifecyclePolicyText' --output text | python3 -m json.tool

# The role trusts one repository on one branch, and nothing else
aws iam get-role --role-name "$(terraform output -raw ci_role_arn | cut -d/ -f2)" \
  --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition' --output json
```

The last one is worth reading rather than skimming. A `sub` value ending in anything other than the intended branch, or a missing `aud`, is the difference between a scoped role and an open one.

## The one manual step

The role ARN goes into a repository secret named `AWS_CI_ROLE_ARN`, which the workflow reads:

```bash
terraform output -raw ci_role_arn        # paste into GitHub → Settings → Secrets
```

The ARN is not a credential — the trust policy refuses every other repository regardless of who knows it — but it carries the account id, which stays out of a public repository for the same reason the state bucket name does.

The publishing side lives in [.github/workflows/ci.yml](../../../.github/workflows/ci.yml) and depends on three properties of this stack:

- **`id-token: write` on the publish job only.** Job permissions replace the workflow's, so the other jobs cannot request a token at all.
- **The image is carried from the job that scanned it**, rather than rebuilt. A rebuild would publish bytes no gate ever examined.
- **A push is skipped when the tag already exists**, using the `ecr:DescribeImages` grant. Immutable tags make a re-run on a published commit fail otherwise, and re-running a workflow is ordinary.

## Managing it

**Changing the retention count** takes effect on the next evaluation, which runs asynchronously within roughly a day. Lowering it deletes images immediately eligible under the new number — check what would be lost before applying a reduction.

**Adding a permission** means editing `ci_permissions` in [oidc.tf](oidc.tf). Resist `ecr:*`: the actions listed are the push path, and each one that is not there is one a leaked token cannot perform.

**Allowing releases from tags** means a second `sub` value such as `repo:owner/repo:ref:refs/tags/v*`, which needs `StringLike` rather than `StringEquals`. Widen the test only for the value that requires it, and never for the repository segment.

**Requiring a human before deploy** means pointing `sub` at a GitHub environment (`repo:owner/repo:environment:production`) instead of a branch. An environment can demand manual approval, so the token is not issued at all until someone approves.

**Tearing it down** fails while the repository holds images, which is the useful default — `force_delete` is off. Deleting the OIDC provider breaks every workflow in every repository that trusts it, so confirm nothing else uses it before destroying.

## What it does not cover

**Scan-on-push is not a replacement for the Trivy job.** ECR basic scanning covers operating system packages only. Language dependencies need enhanced scanning through Amazon Inspector, which is billed per image. The CI job covers both today, so this is a free second signal rather than the primary control.

**Nothing here pulls.** The instance that runs the image needs read access of its own, granted through an instance profile in the stack that creates it — not by widening this role.

**No cross-account access.** That would be a repository policy on the registry rather than an IAM policy on the role, and it only arises with a second account in the picture.
