# CI

What runs on every change, and why each gate is set where it is. For running and testing locally, see [api.md](api.md).

[.github/workflows/ci.yml](../.github/workflows/ci.yml) triggers on every push to `main` and every pull request. Four jobs, in parallel, roughly three minutes of wall clock. The repository is public, so GitHub-hosted runners cost nothing.

| Job          | Catches                                                                              |
| ------------ | ------------------------------------------------------------------------------------ |
| `quality`    | type errors, lint, formatting, high-severity advisories in shipped dependencies      |
| `test`       | the integration suite against a real Postgres                                        |
| `dockerfile` | Dockerfile smells, without building anything                                         |
| `image`      | that the image builds, carries no fixable HIGH/CRITICAL CVE, and drains on `SIGTERM` |

## Why each gate sits where it does

Every threshold below is chosen so the pipeline stays worth reading. A job that goes red for reasons unrelated to the change teaches people to ignore red, and then it protects nothing.

**The test job runs `npm test`, not a service container.** GitHub can run Postgres alongside a job, but that means a second definition of the database — version, credentials, health check — free to drift from `infra/docker-compose.yaml`. Running the developer's own command keeps one way of bringing it up. `cp .env.example .env` comes first, which also fails the build when a new variable never reached the example file.

**`npm audit` is gated at `--omit=dev --audit-level=high`.** Advisories are published by third parties at any moment, so an ungated audit fails a pull request over something its author never touched. `--omit=dev` because only runtime dependencies reach the image.

**Trivy needs `ignore-unfixed`.** Base images routinely carry advisories with no fix released. Failing on those makes the job permanently red; failing only on what is fixable means the remedy is always an upgrade that exists.

**hadolint runs at `failure-threshold: warning`.** Its remaining info-level findings here are advice about layer count in the published image, and the extra layers live in a build stage that is discarded.

## What the image scan is for

`npm audit` reads `package.json`. It cannot see the Linux distribution inside the image, nor npm's own bundled dependencies, and both ship in every layer a deploy pulls.

That gap is not theoretical: the first scan of this image reported one CRITICAL and six HIGH advisories, all in `brace-expansion`, `ip-address`, `tar` and `undici` — none of them project dependencies. They live in `/usr/local/lib/node_modules/npm/`, shipped by the base image, invisible to `npm audit`, and never loaded by anything at runtime. Removing npm from the runtime stage cleared all seven. The Debian layer itself reported zero.

## Supply chain of the pipeline itself

Actions are referenced by tag. A tag is mutable: whoever owns the action can repoint it at other code, which then runs on the runner with the job's token. The risk is bounded here by `permissions: contents: read` at the top of the workflow, a public repository, and no secrets in any job. **Pin by commit SHA before deploy credentials enter a workflow** — at that point a compromised action reaches the AWS account.

`concurrency` with `cancel-in-progress` drops a run whose answer a newer push already invalidated.

## Authenticating to AWS

A workflow that deploys needs AWS credentials, and there are two ways to give it some. The difference is not convenience — it is whether a credential capable of reaching the account exists at rest anywhere.

**Not an IAM user.** The classic approach creates an IAM user, generates an access key, and stores it in repository secrets. That key never expires. It stays valid until someone remembers to rotate it, it is readable by every workflow in the repository, and it survives being copied — out of a log with incomplete masking, out of a compromised third-party action, out of a fork of the configuration. Rotation shortens the window; it does not remove the object being protected.

**GitHub OIDC** removes it. The account trusts GitHub's OIDC issuer as an identity provider, and the workflow exchanges a short-lived signed token for temporary credentials via `sts:AssumeRoleWithWebIdentity`:

1. the job requests `permissions: id-token: write` and receives a JWT from GitHub describing the repository, the branch and the event that triggered it,
2. `aws-actions/configure-aws-credentials` presents that token to STS,
3. AWS verifies the signature against the registered provider and checks the role's trust policy,
4. the job receives credentials that expire within the hour.

Nothing is stored, so nothing can leak from storage, and a token that escapes is worthless in an hour.

**The whole guarantee lives in the trust policy's conditions**, and a wrong one silently gives it away:

```hcl
condition {
  test     = "StringEquals"
  variable = "token.actions.githubusercontent.com:sub"
  values   = ["repo:<owner>/<repo>:ref:refs/heads/main"]
}
condition {
  test     = "StringEquals"
  variable = "token.actions.githubusercontent.com:aud"
  values   = ["sts.amazonaws.com"]
}
```

The `sub` claim binds the role to one repository **and** one branch — a fork, a pull request from a fork, or a different repository under the same owner all present a different `sub` and are refused. Two mistakes undo this: writing the condition with `StringLike` and a wildcard such as `repo:<owner>/*`, which admits every repository the owner will ever create, and omitting `aud`, which leaves the policy open to tokens issued for another audience.

Binding `sub` to a GitHub **environment** (`repo:<owner>/<repo>:environment:production`) rather than a branch is the stronger form, because an environment can require a manual approval before the job starts — the deploy then cannot happen without a human, enforced on GitHub's side before a token is ever issued.

The role's permissions are a separate question from its trust policy, and both need to be narrow: a deploy role needs push access to one ECR repository and whatever triggers the rollout, not the ability to read the account.

## Dependabot

[.github/dependabot.yml](../.github/dependabot.yml) watches three ecosystems weekly:

| Ecosystem        | Why                                                             |
| ---------------- | --------------------------------------------------------------- |
| `npm`            | project dependencies                                            |
| `github-actions` | the actions above, whose tags this file's own advice depends on |
| `docker`         | the base image's tag, when a new major appears                  |

Minor and patch updates arrive grouped into one pull request, production and development separately. Majors come individually: burying a breaking change inside a batch is how it gets merged unread.

The two mechanisms play different roles and need each other. Dependabot is the flow — updates arrive as pull requests the pipeline validates. `npm audit` in CI is the barrier — nothing merges with a high-severity advisory in what ships. The barrier is set high precisely so it does not fight the flow.

`serverless/` is deliberately not watched: it shares no code with `src/` and is not deployed, so updates there would be noise.

**The `docker` ecosystem tracks tags, not digests.** `node:24-slim` is a rolling tag, so a patched base image arrives as a new digest under the same name and produces no pull request. What picks it up is the image job rebuilding on every push. Dependabot would only speak up when a new major appears, which is a decision rather than a patch. Pinning the base by digest would change that, at the cost of a pull request for every upstream rebuild.

## Branch protection

Deliberately absent. Required status checks only mean something with a pull request flow; with commits going straight to `main`, a rule the only committer bypasses is ceremony. CI on push still reports a broken `main` — after the fact, which is the trade being made.

Adopt the flow first, then the protection. The order matters: protection added to a workflow nobody follows gets disabled the first time it is inconvenient.
