# CI

What runs on every change, and why each gate is set where it is. For running and testing locally, see [api.md](api.md).

[.github/workflows/ci.yml](../.github/workflows/ci.yml) triggers on every push to `main` and every pull request. Four gates run in parallel, roughly three minutes of wall clock. The repository is public, so GitHub-hosted runners cost nothing.

| Job          | Catches                                                                              |
| ------------ | ------------------------------------------------------------------------------------ |
| `quality`    | type errors, lint, formatting, high-severity advisories in shipped dependencies      |
| `test`       | the integration suite against a real Postgres                                        |
| `dockerfile` | Dockerfile smells, without building anything                                         |
| `image`      | that the image builds, carries no fixable HIGH/CRITICAL CVE, and drains on `SIGTERM` |

Two more jobs run only on `main`, and neither is a gate: `publish` delivers the image, and `migrate` moves the schema. See [publishing](#publishing) and [applying migrations](#applying-migrations).

## Why each gate sits where it does

Every threshold below is chosen so the pipeline stays worth reading. A job that goes red for reasons unrelated to the change teaches people to ignore red, and then it protects nothing.

**The test job runs `npm test`, not a service container.** GitHub can run Postgres alongside a job, but that means a second definition of the database — version, credentials, health check — free to drift from `infra/docker-compose.yaml`. Running the developer's own command keeps one way of bringing it up. `cp .env.example .env` comes first, which also fails the build when a new variable never reached the example file.

**`npm audit` is gated at `--omit=dev --audit-level=high`.** Advisories are published by third parties at any moment, so an ungated audit fails a pull request over something its author never touched. `--omit=dev` because only runtime dependencies reach the image.

**Trivy needs `ignore-unfixed`.** Base images routinely carry advisories with no fix released. Failing on those makes the job permanently red; failing only on what is fixable means the remedy is always an upgrade that exists.

**hadolint runs at `failure-threshold: warning`.** Its remaining info-level findings here are advice about layer count in the published image, and the extra layers live in a build stage that is discarded.

## What the image scan is for

`npm audit` reads `package.json`. It cannot see the Linux distribution inside the image, nor npm's own bundled dependencies, and both ship in every layer a deploy pulls.

That gap is not theoretical: the first scan of this image reported one CRITICAL and six HIGH advisories, all in `brace-expansion`, `ip-address`, `tar` and `undici` — none of them project dependencies. They live in `/usr/local/lib/node_modules/npm/`, shipped by the base image, invisible to `npm audit`, and never loaded by anything at runtime. Removing npm from the runtime stage cleared all seven. The Debian layer itself reported zero.

## The runner's architecture is the image's architecture

`docker build` produces an image for the machine it runs on. A default GitHub runner is x86, the deployment host is Graviton, and an image for the wrong one is accepted by every gate in this pipeline — built, scanned, tested, pushed, pulled — and fails only when the container is started, with an exec format error and a restart loop.

So the jobs that build or run the image use an arm64 runner, which is free for public repositories and native rather than emulated. The jobs that only move bytes do not need one, and `docker load` and `docker push` are indifferent to architecture.

That split is easy to get wrong later, so the image job **asserts the architecture it produced** rather than trusting the runner label to stay correct. It is the only check in the pipeline that would catch a runner being changed back.

## Supply chain of the pipeline itself

**Every action is pinned by commit SHA**, with the version it corresponds to in a trailing comment. A tag is mutable: whoever owns the action can repoint it at other code, which then runs on the runner with the job's token. A SHA cannot be repointed, so an upgrade becomes a reviewed diff instead of a silent substitution.

The threshold that makes this worth its cost is a job that can reach AWS. A job limited to `contents: read` on a public repository gives a compromised action nothing worth taking; a job that can mint an AWS token gives it a way into the account, bounded only by what the role's policy allows.

**The pin covers every job, not only that one.** Whatever builds the image and hands it over can substitute what gets published, so the whole path from `docker build` to `docker push` is one trust decision. Pinning only the actions standing next to the credentials would protect the last step of a chain that was already compromised.

The cost is that an action update arrives as a pull request rather than as nothing at all. Dependabot moves the SHA and the comment together, so the pin does not stop updates — it makes them visible.

`concurrency` drops a run whose answer a newer push already invalidated — on pull requests only, for the reason in [why runs on main queue instead of cancelling](#why-runs-on-main-queue-instead-of-cancelling).

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

The implementation is [infra/terraform/delivery](../infra/terraform/delivery), which carries the runbook.

## Publishing

The `publish` job pushes the image to ECR, tagged with the commit it was built from. Three properties are what make it worth more than a `docker push`.

**It ships the bytes that were tested, not a rebuild of them.** The `image` job hands its build to `publish` as an artifact rather than letting it build again. A rebuild produces a plausibly identical image, and plausibly is the wrong standard: a base image republished between two jobs, or a different layer order, is enough to make the scan result untrue of what actually shipped. Carrying the tarball costs a minute and removes the doubt.

**It waits for every gate, not just the image one.** An image built from a commit that fails lint or the integration suite is not one to keep, so `publish` needs all four jobs rather than only the one that produced it.

**A re-run publishes nothing.** Registry tags are immutable, so pushing an existing one fails — and re-running a workflow on a commit that already published is an ordinary thing to do. The job asks the registry first and exits cleanly when the tag is there. The alternative, a red build on a rerun, teaches people that red means nothing.

**The tag is the commit, and there is no `latest`.** Immutability is repository-wide, so no tag can be repointed. Which image is deployed is therefore recorded by the deploy rather than by a name that moves underneath it — the property that makes a rollback a lookup instead of a rebuild.

### Delivery is not deployment

`publish` completes continuous **delivery**: every approved commit produces an artifact that could be deployed, addressable by the commit it came from. Nothing in production changes, and the two halves of "CD" are worth keeping apart, because conflating them makes the remaining work invisible.

Continuous **deployment** needs, beyond somewhere to deploy to:

- a rollout mechanism — an instruction to the host to pull a tag and restart, or a new task definition revision;
- a record of the desired version, since no moving tag carries it. That record is also what makes a rollback one command;
- a migration strategy: schema changes must apply exactly once, before the new code serves traffic, and stay compatible with the code still running during the changeover;
- a health check that decides whether the rollout succeeded, and an automatic way back when it did not;
- one more grant on the CI role, which today can only push.

## Security caveats

The pipeline's own attack surface, and what bounds each part of it.

**Every job runs code from the branch under test.** `npm ci` executes lifecycle scripts and `docker build` runs a Dockerfile, both taken from the change being verified. That is inherent to testing a change rather than a flaw, and what bounds it is that pull requests from forks receive no secrets and a read-only token. **That boundary holds only while `id-token: write` stays scoped to the publishing job.** Moving it to the top of the file would hand every pull request the ability to request an AWS token.

**`pull_request_target` removes that boundary completely.** It runs the base branch's workflow, with full access to secrets, against code from the pull request. It exists for labelling and triage, and has no place in a workflow that can reach AWS.

**The role is the blast radius, not the token.** A token that escapes a run expires within the hour and can do exactly what the role's policy permits: push to one repository. That is why the policy enumerates the push actions instead of granting `ecr:*`, and why a deploy permission is added only when there is something to deploy.

**The role ARN is stored as a secret and is not one.** It is kept out of the repository because it carries the account id, not because knowing it grants anything — the trust policy refuses every repository but one regardless of who reads the ARN. Its exposure is not a breach; an unreviewed change to the trust policy is.

**Publishing is gated by branch, and the branch is not protected.** Anyone able to push to `main` can publish an image, since branch protection is deliberately absent — see below. That is tolerable while publishing only writes to a registry, and stops being tolerable once the same role can deploy. A GitHub environment with required reviewers is the answer to that, and it moves the branch restriction from AWS to GitHub: a job declaring an environment receives `sub` of the form `repo:owner/repo:environment:name`, so the trust policy can no longer see which branch ran. The environment's own deployment branch policy becomes the only place that rule exists.

**Artifacts are as readable as the repository.** The image travels between jobs as a build artifact, which anyone who can read the repository's runs can download. It holds no secret, because configuration reaches the container at runtime — and that property has to survive: an image with a credential baked in must never be passed this way.

**Cache scope is GitHub's guarantee, not this repository's.** `cache: npm` is shared across runs. A pull request cannot write into the cache that `main` reads, because GitHub isolates caches per branch with only one-way inheritance. Nothing here enforces that, so it is worth knowing it is inherited rather than configured.

## Applying migrations

The `migrate` job runs the schema change from the image that was just published, on `main` only. It is the release phase: the schema moves forward, and only then can anything serve the code that expects it.

**It runs after `publish` rather than beside it.** A release with no published image has nothing to deploy, so moving a schema on its behalf would be a change with no release behind it.

**It holds database credentials and no AWS access, and `publish` holds the AWS token and no database credentials.** Splitting the two jobs is what makes that possible; a single job doing both would hand either credential to whatever compromised the other.

**It runs the published image rather than the repository.** The migration SQL and the code that expects it ship together, so invoking the image is what keeps them from being applied out of step.

**The statement timeout is disabled for this run only**, since DDL against a populated table can legitimately exceed any value that makes sense for a request. The application keeps its timeout so a stuck query cannot hold a pool connection.

Whether it is safe to apply a schema change automatically is not a property of the pipeline but of the change: it holds exactly as long as migrations stay compatible with the release before them — see [api.md](api.md#rollback-and-schema-compatibility).

### Why runs on main queue instead of cancelling

`cancel-in-progress` is switched off for `main`. Cancelling a run is correct while a run is only an _answer_ about a commit — a newer push makes the older answer irrelevant. It stops being correct once a run publishes an image and moves a schema, because a cancellation halfway through leaves a release half made. Pull requests keep the old behaviour, where cancelling saves runner time and loses nothing.

## Dependabot

[.github/dependabot.yml](../.github/dependabot.yml) watches three ecosystems weekly:

| Ecosystem        | Why                                                       |
| ---------------- | --------------------------------------------------------- |
| `npm`            | project dependencies                                      |
| `github-actions` | the pinned SHAs above, which nothing else would ever move |
| `docker`         | the base image's tag, when a new major appears            |

Minor and patch updates arrive grouped into one pull request, production and development separately. Majors come individually: burying a breaking change inside a batch is how it gets merged unread.

The two mechanisms play different roles and need each other. Dependabot is the flow — updates arrive as pull requests the pipeline validates. `npm audit` in CI is the barrier — nothing merges with a high-severity advisory in what ships. The barrier is set high precisely so it does not fight the flow.

`serverless/` is deliberately not watched: it shares no code with `src/` and is not deployed, so updates there would be noise.

**The `docker` ecosystem tracks tags, not digests.** `node:24-slim` is a rolling tag, so a patched base image arrives as a new digest under the same name and produces no pull request. What picks it up is the image job rebuilding on every push. Dependabot would only speak up when a new major appears, which is a decision rather than a patch. Pinning the base by digest would change that, at the cost of a pull request for every upstream rebuild.

## Branch protection

Deliberately absent. Required status checks only mean something with a pull request flow; with commits going straight to `main`, a rule the only committer bypasses is ceremony. CI on push still reports a broken `main` — after the fact, which is the trade being made.

Adopt the flow first, then the protection. The order matters: protection added to a workflow nobody follows gets disabled the first time it is inconvenient.
