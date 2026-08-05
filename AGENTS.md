# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- BEGIN:project-initial-rules -->

## Project

A Calendly-inspired scheduling backend: Express 5 + TypeScript + PostgreSQL (Drizzle ORM), organized as Clean Architecture. There is also an unfinished `serverless/` AWS SAM project (separate npm package, its own `tsconfig.json`) that is currently just a Hello World Lambda handler and shares no code with `src/`.

## Commands

```bash
npm run dev            # docker down → up → db:migrate → nodemon src/index.ts (port 4000)
npm test               # starts the dev server, waits on /health, runs jest --runInBand; posttest stops docker
npm run build          # tsc → dist/ + copies the migration SQL into dist/
npm run lint:check     # eslint
npm run prettier:fix   # format
npm run commit         # commitizen; commitlint (conventional commits) is enforced by a husky commit-msg hook
```

Migrations: `npm run drizzle:generate` (after editing the schema) → `npm run db:migrate`. `drizzle-kit` only generates; applying always goes through `src/shared/database/migrate.ts` (drizzle-orm's own migrator, advisory-locked), so dev and prod share one code path. Production runs the compiled `db:migrate:prod` as a one-shot container. Also available: `drizzle:studio` / `drizzle:drop`.

Docker/Postgres alone: `npm run services:up` / `services:stop` / `services:down`.

### Running a single test

All tests are **integration** tests: they `supertest` a real server at `http://localhost:4000` (hardcoded `BASE_URL` in each file) backed by the Docker Postgres. `npm test` is the only script that brings up both. To iterate on one file, run `npm run dev` in one terminal and then:

```bash
npx jest tests/integration/user/post.test.ts
npx jest -t "Should return 201"     # by test name
```

`tests/orchestrator.ts` `clearDatabase()` TRUNCATEs every public table and is called in `beforeEach`, so tests must run serially (`--runInBand`).

## Architecture

`src/modules/<user|meeting|scheduling>/` each follow the same layering; `src/shared/` holds cross-cutting code.

**Request flow:** `routes/index.ts` → `Controller` → `UseCase` → `IRepo` (Drizzle impl) → `Map.toDomain()` → domain entity.

- **routes/index.ts** — also the DI container. Repos, use cases, and controllers are instantiated by hand at module load and closed over by the route handlers. A module needing another module's data imports that module's repo directly (e.g. meeting routes construct `UserRepo`). Routers are mounted unprefixed in [src/app.ts](src/app.ts); order matters — `/meetings/user/:userId` is registered before `/meetings/:id`.
- **useCases/<name>/** — one directory per operation holding `Controller` + `UseCase` + `DTO`. Controllers implement `BaseController` and own HTTP concerns plus input sanitization (`TextUtils.sanitize`, DOMPurify + jsdom) before handing a DTO to the use case. Use cases implement `UseCase<IRequest, IResponse>`, take repo interfaces via constructor, and catch/rethrow: `DefaultError` subclasses pass through, anything else becomes a generic `Error`.
- **domain/** — entities validate in their constructor (via `Guard` and static `isValid*` helpers) and throw `BadRequestError`; all fields are `readonly` and ids default to a v4 uuid. Constructing an entity is the validation step — there is no separate validator layer.
- **repositories/** — `I<X>Repo` interface + `drizzle/<X>Repo.ts` implementation. Repos throw `NotFoundError` on missing rows and return domain entities through the mapper, never raw rows.
- **mappers/** — thin `toDomain(raw)` wrappers around the entity constructor.

**Errors:** everything extends `DefaultError` (`errors.ts`) which carries an HTTP `code`. Nothing is caught in routes — Express 5 forwards async rejections to [src/shared/core/errorHandler.ts](src/shared/core/errorHandler.ts), which maps `err.code`/`err.message` to a uniform `{ message }` response. Anything that is not a `DefaultError` responds `500` with an opaque message plus an `errorId` that ties it to the server log; never widen that to include the original message in production. Add new error types to `errors.ts` rather than status codes in controllers.

**Entrypoint:** [src/app.ts](src/app.ts) builds the Express app (middlewares, routes, error handlers); [src/index.ts](src/index.ts) owns the process — `listen`, keep-alive timeouts tuned above the ALB idle timeout, and the drain-then-close shutdown driven by `shared/core/lifecycle.ts`. `/health` answers `503` while draining.

**Database:** [src/shared/database/schema.ts](src/shared/database/schema.ts) is the single source of truth (users / meetings / scheduling, text uuid PKs, shared `timestamps` helper). Migrations are generated into `src/shared/database/migrations/` — edit the schema and regenerate, never hand-write migration SQL. `conn.ts` owns an explicit `pg` `Pool` (capped by `DATABASE_POOL_MAX`) and exports it alongside the module-level `db` singleton — the pool is exported so the shutdown path can close it.

## Conventions

- Datetimes crossing the API boundary must be full ISO-8601 UTC strings ending in `Z` (`TextUtils.isValidUTCDate`); use cases validate the string, then convert to `Date` before building the entity.
- Create endpoints respond `{ success, message }`; read endpoints respond `{ data }`.
- Relative imports only — there are no path aliases.
- Copy `.env.example` to `.env`; docker-compose reads the same `.env` for Postgres credentials.

<!-- END:project-initial-rules -->

## General Rules

- Do not commit or push on your own. Make the changes and stop; commit/push only when the user explicitly asks (never as a "wrap up the task" step).
- Documentation is centralized in docs/. README.md is kept lean on purpose — do not duplicate docs there; when a flow changes, update /docs.
- Do not assume anything. Always ask when in doubt.
