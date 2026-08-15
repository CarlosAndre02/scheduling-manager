# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- BEGIN:project-initial-rules -->

## Project

A Calendly-inspired scheduling backend: Express 5 + TypeScript + PostgreSQL (Drizzle ORM), organized as Clean Architecture. A `serverless/` AWS SAM project sits alongside it as a separate npm package with its own `tsconfig.json`, and shares no code with `src/`.

## Documentation

Read the relevant one before changing an area, and update it when a flow changes:

- [docs/architecture.md](docs/architecture.md) — layering, request flow, DI, error model, process lifecycle, database design, tooling
- [docs/api.md](docs/api.md) — setup, running, testing, HTTP contract, dependency practice, migrations in production
- [docs/ci-cd.md](docs/ci-cd.md) — what runs on every push, why each gate sits where it does, Dependabot
- [docs/aws-governance.md](docs/aws-governance.md) — AWS identities, account structure, permission sets, cost guardrails, audit trail, and the pitfalls found along the way
- [docs/aws-stack-implementation.md](docs/aws-stack-implementation.md) — how the infrastructure is split into Terraform stacks, what each owns, apply order, state backend
- [docs/vpc.md](docs/vpc.md) — the network model: VPC, subnets, AZs, internet/NAT gateways, VPC endpoints, security groups
- [docs/terraform.md](docs/terraform.md) — the declarative model, state, imports, and how stacks under `infra/terraform/` are run

## Commands

```bash
npm run dev            # docker down → up → db:migrate → nodemon src/index.ts (port 4000)
npm test               # brings up the server + Postgres, runs jest --runInBand, stops docker
npm run test:image     # builds the image and asserts its contents + SIGTERM drain (needs Docker)
npm run build          # tsc → dist/ + copies the migration SQL into dist/
npm run lint:check     # eslint
npm run prettier:fix   # format
npm run commit         # commitizen (conventional commits, enforced by a husky hook)
```

Tests are **integration only** and hit a real server on `http://localhost:4000`. To run a single file, keep `npm run dev` in another terminal — see [docs/api.md](docs/api.md#testing).

Migrations: `npm run drizzle:generate` after editing the schema, then `npm run db:migrate`. `drizzle-kit` only generates; applying always goes through `src/shared/database/migrate.ts`.

## Rules

- Raw `req.body`/`req.params` values are read only through `RequestInput` ([src/shared/core/RequestInput.ts](src/shared/core/RequestInput.ts)) — never `.trim()` a field straight off the request, which turns a missing field into a 500.
- Validate and reject input; never rewrite it. Free text is stored exactly as sent, and anything containing an HTML tag is refused with a 400 — this API answers JSON, so escaping is the consumer's job at render time.
- Datetimes crossing the API boundary must be full ISO-8601 UTC strings ending in `Z` (`TextUtils.isValidUTCDate`); use cases validate the string, then convert to `Date` before building the entity.
- Create endpoints respond `{ success, message }`; read endpoints respond `{ data }`; list endpoints add `{ pagination }` and take `limit`/`offset` through `parsePagination` ([src/shared/core/Pagination.ts](src/shared/core/Pagination.ts)) — never return an unbounded collection.
- Invariants that two concurrent requests could both satisfy are enforced by a database constraint, not by a check in a use case.
- Errors extend `DefaultError` and are added to `errors.ts`; controllers never set status codes. A `500` must stay opaque in production.
- Never hand-write migration SQL — edit the schema and regenerate.
- Relative imports only — there are no path aliases.
- Copy `.env.example` to `.env`; docker-compose reads the same `.env` for Postgres credentials.

<!-- END:project-initial-rules -->

## General Rules

- Do not commit or push on your own. Make the changes and stop; commit/push only when the user explicitly asks (never as a "wrap up the task" step).
- Only read-only commands against external services and infrastructure (`terraform`, `aws`, `supabase`, `vercel` and equivalents). Inspecting is fine — `terraform plan`, `terraform validate`, `aws ... describe`. Never run one that creates, modifies or destroys: `terraform apply`, `terraform destroy`, `terraform import`, any `aws` call that writes. Hand those over; the user runs them and reports back. The local toolchain (npm, jest, eslint, prettier) is not covered by this.
- Documentation is centralized in docs/; when a flow changes, update /docs. README.md carries only the entry point — why the project exists, requirements, how to run it, how to test it, and the shape of the architecture — and links to /docs for everything else.
- Documentation never records current state or anything else that ages ("currently", "so far", "previously"). Write the rule or the reason, not the snapshot.
- Do not assume anything. Always ask when in doubt.
