# Scheduling Manager

A backend scheduling manager application inspired by Calendly, developed with TypeScript, Express, and PostgreSQL.

## Why

The main goal is to close knowledge gaps in AWS and DevOps in general. The application is deliberately kept simple for that reason.

## Requirements

- Node.js 24 (enforced by `engines` + `engine-strict`)
- Docker + Docker Compose (Postgres runs in a container)

## Setup

```bash
npm install
cp .env.example .env
```

`.env` feeds both the application and `infra/docker-compose.yaml`, so the `POSTGRES_*` values and `DATABASE_URL` have to agree with each other.

## Running

```bash
npm run dev
```

Recreates the Postgres container, applies pending migrations and starts the server on `http://localhost:4000`. Check it with `curl localhost:4000/health`.

## Tests

```bash
npm test
```

Integration only: the suite drives a real server over HTTP against the Docker Postgres — nothing is mocked. `npm test` brings up the server and the database on its own, and stops the containers afterwards; port `4000` must be free.

To run a single file, keep `npm run dev` in another terminal and call jest directly:

```bash
npx jest tests/integration/user/post.test.ts
```

## Clean Architecture

`src/modules/` holds one folder per domain, all following the same layering. `src/shared/` holds what crosses them.

```
src/
  app.ts                     express app: middlewares, routes, error handlers
  index.ts                   the process: listen, timeouts, shutdown
  modules/<user|meeting|scheduling>/
    routes/index.ts          routing + hand-rolled DI
    useCases/<operation>/    Controller + UseCase + DTO
    domain/                  entities (validation lives in the constructor)
    repositories/            I<X>Repo interface + drizzle/ implementation
    mappers/                 raw row → domain entity
  shared/                    core, database, utils
tests/integration/           supertest against a running server
```

A request travels in one direction:

```
routes/index.ts → Controller → UseCase → IRepo (drizzle impl) → Map.toDomain() → entity
```

Use cases depend on repository _interfaces_, never on Drizzle, so the domain has no idea a database exists. Entities validate themselves in the constructor, which means an invalid one cannot be built.

## Documentation

- [docs/architecture.md](docs/architecture.md) — layering, DI, error model, process lifecycle, database design
- [docs/api.md](docs/api.md) — HTTP contract, environment variables, migrations, deployment notes
- [docs/aws-governance.md](docs/aws-governance.md) — AWS identities, account structure, permission sets, cost guardrails, audit trail
- [docs/terraform.md](docs/terraform.md) — declarative model, state, imports; stacks live in [infra/terraform/](infra/terraform/)
