# AWS Identity and Account Governance

How access to AWS is meant to be organized for this project, and why. Written for a solo owner whose project may be commercialized, with notes on what changes once a second person is involved.

## The four ways to sign in

| Option                       | What it is                                                                              | Credential                                              | Use it for                                  |
| ---------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------- |
| **Root user**                | Owner of one AWS account, tied to the signup email. Cannot be restricted by any policy. | Permanent password + MFA                                | Only the handful of tasks that require it   |
| **IAM user**                 | Identity **inside a single account**                                                    | Permanent password and/or access keys that never expire | Avoid for humans; legacy only               |
| **IAM Identity Center user** | Identity **above** the accounts, granted access to many of them                         | Temporary, via portal and `aws sso login`               | The default for people                      |
| **Federated identity**       | Umbrella term: temporary credentials obtained from an external provider (SAML/OIDC)     | Temporary                                               | Corporate IdP for people, OIDC for machines |

Two things that commonly trip people up:

- **Identity Center _is_ federation.** It is not a parallel category — it is AWS's managed implementation of it, either with its own directory or backed by Google Workspace / Entra / Okta.
- **Cognito is unrelated.** It authenticates _your product's end users_, not people accessing your AWS account.

### IAM user vs Identity Center user

An Organization contains **accounts**, not people. An IAM user lives inside one account and does not exist outside it. With three accounts you would create the same person three times — three passwords, three MFA registrations, three sets of access keys, and three places to remember during offboarding.

An Identity Center user is created once and granted access to each account through an assignment. One login, one MFA, one place to revoke.

The practical difference shows up immediately in the terminal:

```bash
aws configure      # IAM user: writes a permanent AKIA... key to ~/.aws/credentials
aws sso login      # Identity Center: browser auth, credentials expire in hours
```

Long-lived access keys on a laptop are the most common source of AWS credential leaks — committed by accident, read by a malicious dependency, or taken with the machine.

### Identities are per-organization

The same person can be root of a personal account, an Identity Center user in a company's organization, and an IAM user in some legacy account, all at once. There is no global AWS identity for a human, and the three know nothing about each other.

One constraint: **an email address can be root of only one AWS account.** The same address may still be an Identity Center username elsewhere — different namespaces, no conflict.

## Roles: the underlying mechanism

A **policy** is the permission (`s3:GetObject` on a bucket). A **role** is an identity with no permanent credential, which something else assumes temporarily. Every role has two halves:

- **Trust policy** — _who_ may assume it (an AWS service, an account, an OIDC provider)
- **Permission policies** — _what_ they can do once assumed

Roles serve people and machines alike:

| Case                         | Trusted principal                          | Grants                                  |
| ---------------------------- | ------------------------------------------ | --------------------------------------- |
| EC2 pulling an image         | `ec2.amazonaws.com`                        | ECR read-only, no key stored on the box |
| CI/CD deploying              | GitHub's OIDC provider, scoped to the repo | ECR push, `ssm:SendCommand`             |
| A person entering an account | IAM Identity Center                        | whatever the permission set defines     |

The last row is the point: **Identity Center users hold no permissions of their own — they assume roles.** IAM users and Identity Center users are just different front doors onto the same mechanism.

## Account structure

```
Management account (aws-root@…)      ← administration only, no workloads
├── AWS Organizations
├── IAM Identity Center
├── Account "prod"   (aws-root+prod@…)
└── Account "dev"    (aws-root+dev@…)
```

Separate accounts per environment exist for **blast radius**, not just for pipeline isolation. The account is the strongest boundary AWS offers: a mistake in dev cannot reach prod because they are different accounts, not because a policy says so. Cost separates without tag discipline, quotas do not compete, and compromised dev credentials grant nothing in prod.

Each account needs a **unique root email** — plus-addressing (`aws-root+prod@…`) covers this on most providers.

The management account holds power over the whole organization, so it runs nothing: Organizations, Identity Center, billing and CloudTrail only.

**Nobody writes to prod by hand.** People hold read-only there for debugging; the pipeline deploys through a role; a deliberately named, short-lived permission set exists for emergencies. In dev, people are administrators — that is what dev is for.

## Permission sets

A permission set is a **template**, not a permission. Assigning one to a group on an account makes AWS create a role in that account (`AWSReservedSSO_<name>_<hash>`) whose trust policy only Identity Center can satisfy. Remove the assignment and the role disappears. This is why `aws sts get-caller-identity` reports an assumed role rather than a user.

Access exists in the **assignment**, a triple of (account, principal, permission set):

| Account    | Principal              | Permission set                |
| ---------- | ---------------------- | ----------------------------- |
| dev        | group `Administrators` | `AdministratorAccess`         |
| prod       | group `Administrators` | `ReadOnlyAccess`              |
| prod       | group `Administrators` | `ProdBreakGlass` (1h session) |
| management | group `Administrators` | `Billing`                     |

Assign to **groups**, never directly to users, even with one person — adding the second person then costs one click instead of rebuilding the matrix.

Two independent timers are worth knowing: the permission set's **session duration** (1–12h) governs how long the temporary credentials last, while the Identity Center **sign-in session** governs how long you stay logged into the portal. The first expiring is renewed silently by `aws sso login`; the second expiring asks for password and MFA again.

## Setup

1. **Create the account** with a dedicated email — a company-owned shared mailbox, or a personal address used for nothing else. Requires a real credit card; virtual cards often fail verification.
2. **MFA on root, two devices.** Best pairing is an authenticator app plus a hardware key: independent failure modes. Two TOTP entries in the same password manager is weak redundancy. Store the TOTP seed somewhere separate from the app — losing the phone with no second factor means identity-proofed recovery by phone with AWS.
3. **Store root credentials** (email, password, MFA seeds, the 12-digit account ID) in a password manager, then stop using root.
4. **Enable Organizations** ("All features", not consolidated billing only) **and IAM Identity Center**. Set MFA to _Always-on_ under Settings → Authentication; the default only challenges in suspicious situations.
5. **Create the child accounts.** Member accounts start with no root password — either set one with MFA per account, or use centralized root access management to remove their root credentials entirely.
6. **Create the user, the group, the permission sets, and the assignments**, then work exclusively through the portal.

Billing, budgets, CloudTrail and alarms are a separate step, but note that **activating IAM access to billing data is root-only** — flip it during the first root session to avoid coming back.

## Daily use

`aws configure sso` writes to `~/.aws/config`:

```ini
[sso-session andre]
sso_start_url = https://andre.awsapps.com/start
sso_region = us-east-1
sso_registration_scopes = sso:account:access

[profile dev]
sso_session = andre
sso_account_id = 222233334444
sso_role_name = AdministratorAccess     # the permission set name
region = sa-east-1
```

The `sso-session` block is shared: one `aws sso login` authenticates every profile pointing at it.

```bash
aws sso login --profile dev
aws sts get-caller-identity --profile dev    # expect assumed-role/AWSReservedSSO_...
AWS_PROFILE=dev terraform plan
```

`region` here is where resources live and is independent of the Identity Center region.

## Things that bite

**Enabling Organizations can move the account off the free plan.** The services themselves cost nothing, but the account's free-tier standing is a separate matter. Where credits matter, confirm the billing consequence before enabling. Account and Billing support is free on every plan, including Basic, and is the right channel when a change was unintentional.

**Closing an account does not reset free-tier eligibility.** It is granted once per customer and assessed by payment method and identity, not by email. A closed account also holds its email for 90 days, and repeated attempts can be treated as abuse.

**The Identity Center region is effectively permanent** — changing it means deleting and recreating the whole configuration.

**The portal subdomain is a one-time choice.**

**Root email choice is irreversible in practice.** Never a personal address for a company account: whoever controls that inbox controls account recovery.

**One browser cannot hold console sessions for several accounts at once.** Use browser profiles or containers. The CLI has no such limitation.
