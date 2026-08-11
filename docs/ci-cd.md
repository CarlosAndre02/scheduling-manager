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
