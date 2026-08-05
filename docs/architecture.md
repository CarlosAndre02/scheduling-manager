# Architecture

How the code is organized and why. For running, testing and the HTTP contract, see [api.md](api.md).

## Layout

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
  shared/                    cross-cutting: core, database, utils
tests/integration/           supertest against a running server
```

The three modules follow the same layering; nothing in `modules/` is generic infrastructure.

## Request flow

```
routes/index.ts → Controller → UseCase → IRepo (drizzle impl) → Map.toDomain() → entity
```

**routes/index.ts** doubles as the DI container. Repos, use cases and controllers are instantiated by hand at module load and closed over by the route handlers — there is no container library. A module that needs another module's data imports that module's repo directly (meeting routes construct `UserRepo`).

Routers are mounted unprefixed in [src/app.ts](../src/app.ts), and **order matters**: `/meetings/user/:userId` is registered before `/meetings/:id`, otherwise `user` would be captured as an id.

**useCases/`<name>`/** holds one directory per operation with three files. Controllers implement `BaseController`, own the HTTP concerns and sanitize input (`TextUtils.sanitize`, DOMPurify over jsdom) before handing a DTO to the use case. Use cases implement `UseCase<IRequest, IResponse>`, receive repo _interfaces_ through the constructor, and catch/rethrow: `DefaultError` subclasses pass through untouched, anything else is replaced with a generic `Error`.

**domain/** entities validate inside their constructor, using `Guard` and static `isValid*` helpers, and throw `BadRequestError`. Every field is `readonly` and ids default to a v4 uuid. Constructing an entity _is_ the validation step — there is no separate validator layer.

**repositories/** pair an `I<X>Repo` interface with a `drizzle/<X>Repo.ts` implementation. They throw `NotFoundError` on missing rows and always return domain entities through the mapper, never raw rows. Constraint violations are translated here as well, through `isUniqueViolation` in [src/shared/database/errors.ts](../src/shared/database/errors.ts) — drizzle nests the pg error under `cause`, and the check should always be narrowed to a constraint name so unrelated collisions are not swallowed.

**mappers/** are thin `toDomain(raw)` wrappers around the entity constructor.

## Errors

Every error type extends `DefaultError` ([src/shared/core/errors.ts](../src/shared/core/errors.ts)), which carries the HTTP `code`. Nothing is caught in routes: Express 5 forwards async rejections to [src/shared/core/errorHandler.ts](../src/shared/core/errorHandler.ts), which maps `err.code`/`err.message` onto a uniform `{ message }` response.

Anything that is _not_ a `DefaultError` answers `500` with an opaque message plus an `errorId` correlating to the server log. Never widen that to include the original message in production — driver errors carry table names, SQL fragments and parameter values.

New error types belong in `errors.ts`, not as status codes inside controllers.

## Process lifecycle

[src/app.ts](../src/app.ts) builds the Express app and knows nothing about the process. [src/index.ts](../src/index.ts) owns the process: `listen`, keep-alive timeouts tuned above the load balancer idle timeout, signal handling, and the drain-then-close shutdown coordinated through `shared/core/lifecycle.ts`. `/health` answers `503` while draining.

`uncaughtException` and `unhandledRejection` log and exit with code 1 without draining — past that point the process state cannot be trusted.

The sequence and its container caveats are documented in [api.md](api.md#shutdown).

## Database

[src/shared/database/schema.ts](../src/shared/database/schema.ts) is the single source of truth: three tables, text uuid primary keys, a shared `timestamps` helper. All datetime columns are `timestamptz` so what persists is an instant rather than a wall-clock reading, and every foreign key cascades on delete.

Migrations are generated into `src/shared/database/migrations/` — edit the schema and regenerate, never hand-write migration SQL.

`conn.ts` owns an explicit `pg` `Pool` (capped by `DATABASE_POOL_MAX`) and exports it next to the module-level `db` singleton; the pool is exported so the shutdown path can close it and so the migration runner can hold an advisory lock.

**Invariants that two concurrent requests could both satisfy are enforced by a database constraint, not by a check in the use case.** A check followed by an insert is not atomic. This applies to the unique email and to the partial unique index preventing double booking; the application-level check stays only to produce a friendly message.

## Tooling

- **eslint** + **prettier** (`lint:check`, `prettier:fix`), with `dist/`, `coverage/` and `serverless/` ignored.
- **husky** `commit-msg` runs commitlint (conventional commits); `pre-commit` runs **lint-staged**, formatting staged files with Prettier. Its config lives in `package.json`.
- Generated migration files are excluded from Prettier via `.prettierignore` to avoid churn on regeneration.
- Relative imports only — there are no path aliases.
