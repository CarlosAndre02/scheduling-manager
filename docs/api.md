# API — Running and Testing

How to get the Scheduling Manager API running locally and how to exercise it, both by hand and through the test suite. For how the code is organized, see [architecture.md](architecture.md); for what runs on every push, see [ci-cd.md](ci-cd.md).

## Requirements

- Node.js 24 (pinned by `engines`; `.npmrc` sets `engine-strict`, so another major fails the install rather than warning)
- Docker + Docker Compose (Postgres runs in a container)

## Setup

```bash
npm install
cp .env.example .env
```

`.env` is read by both the application and `infra/docker-compose.yaml` (the Postgres container gets its credentials from the same file), so the `POSTGRES_*` values and the `DATABASE_URL` must stay consistent with each other.

| Variable                                              | Default                                                                    | Used by                                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `NODE_ENV`                                            | `development`                                                              | enables Drizzle query logging when not `production`                         |
| `SERVER_PORT`                                         | `4000`                                                                     | Express                                                                     |
| `TRUSTED_PROXY_HOPS`                                  | `0` locally, `1` behind one proxy                                          | how far into `X-Forwarded-For` Express looks to resolve `req.ip`            |
| `CORS_ORIGINS`                                        | empty                                                                      | comma-separated origins allowed to read responses from a browser            |
| `POSTGRES_HOST` / `POSTGRES_PORT`                     | `localhost` / `5432`                                                       | Postgres container                                                          |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `local_user` / `local_password` / `scheduling_manager`                     | Postgres container                                                          |
| `DATABASE_URL`                                        | `postgresql://local_user:local_password@localhost:5432/scheduling_manager` | Drizzle (app + migrations)                                                  |
| `DATABASE_POOL_MAX`                                   | `10`                                                                       | connection pool ceiling **per container**                                   |
| `SHUTDOWN_DRAIN_DELAY_MS`                             | `0` locally, `5000`+ behind a load balancer                                | how long `/health` reports unhealthy before connections stop being accepted |
| `SHUTDOWN_TIMEOUT_MS`                                 | `15000`                                                                    | grace period for in-flight requests before sockets are forced closed        |

**`TRUSTED_PROXY_HOPS` counts the proxies that append `X-Forwarded-For`, not the network hops.** Traefik, Caddy, an ALB and CloudFront all append it by default; nginx appends nothing unless configured with `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`. A bare `proxy_pass` therefore stays at `0`. See [architecture.md](architecture.md#input) for why over-counting is worse than under-counting.

## Running

```bash
npm run dev
```

That single command recreates the Postgres container (`services:down` → `services:up --wait`), applies pending Drizzle migrations, and starts the server with nodemon on `http://localhost:4000`. Confirm it is up:

```bash
curl http://localhost:4000/health
# {"status":"OK","timestamp":"2026-08-03T12:00:00.000Z"}
```

Useful side commands:

```bash
npm run services:up      # only Postgres
npm run services:stop    # stop containers, keep the volume
npm run services:down    # remove containers, keep the volume
npm run drizzle:studio   # browse the database
```

Production-ish run: `npm run build && npm start` (serves `dist/`; migrations are a separate step, see below).

### Container image

```bash
docker build -t scheduling-manager:$(git rev-parse --short HEAD) .
docker run --rm -p 4000:4000 --env-file .env scheduling-manager:<tag>
```

Tag by commit SHA, never `latest`: a rollback needs a target that does not move.

The [Dockerfile](../Dockerfile) is multi-stage. The build stage installs every dependency and runs `npm run build`; the runtime stage starts from a clean base and copies only `dist/`, the pruned `node_modules` and `package.json`. TypeScript, jest, eslint and the source itself never reach the published image — smaller to pull, and far less for a scanner or an intruder to find.

Five details the image depends on:

- **`CMD` is exec form.** Shell form would put `/bin/sh` at PID 1 with Node as its grandchild, and `sh` does not forward `SIGTERM` — the drain below would never run and the container would be `SIGKILL`ed with requests in flight.
- **`HUSKY=0` during the build.** `npm ci` triggers the `prepare` script, and husky has no `.git` to install hooks into.
- **The process runs as the unprivileged `node` user**, so a container escape does not begin as root.
- **`.dockerignore` excludes `.env`.** Without it the build context carries the file straight into the image.
- **npm is removed from the runtime stage.** Nothing at runtime uses it, and its own bundled dependencies carry advisories that a scanner counts against the image regardless. It also stops a shell in the container from being a package installer. The consequence is that anything invoking the image runs `node` directly, migrations included.

`npm run build` also copies the migration SQL into `dist/`, so the image can run its own migrations — see below.

Two behaviours that read as functional and are not:

- **`EXPOSE` publishes nothing.** It is metadata: `docker run -P` and Traefik's port discovery read it, nothing else. What decides the listening port is `SERVER_PORT`. Because one is build-time and the other run-time, they cannot be kept in sync — so leave `SERVER_PORT` at its default inside the container and choose where it appears from the host (`-p 8080:4000`).
- **`HEALTHCHECK` does not restart anything.** Docker only flips the container's status; reacting is the orchestrator's job. With a plain `docker run`, an unhealthy container keeps running.

### Shutdown

On `SIGTERM`/`SIGINT` the server drains instead of dying: `/health` starts answering `503`, and only after `SHUTDOWN_DRAIN_DELAY_MS` does it stop accepting connections. That window is what lets a load balancer deregister the instance before its in-flight requests are cut. In-flight work then gets up to `SHUTDOWN_TIMEOUT_MS` to finish before sockets are forced closed, and the connection pool is closed last.

This only works if the Node process actually receives the signal — in a container that means an exec-form `CMD` (or `docker run --init`), so Node is PID 1.

**Whoever stops the container has to allow enough time.** `docker stop` sends `SIGTERM` and follows it with `SIGKILL` after 10 seconds by default, while a full drain takes up to `SHUTDOWN_DRAIN_DELAY_MS + SHUTDOWN_TIMEOUT_MS` — 20 seconds with the values above. The default kills the process mid-drain, cutting exactly the requests the drain exists to protect. The grace period lives with the caller, not in the image:

| Where               | Setting                  |
| ------------------- | ------------------------ |
| `docker stop`       | `-t 30`                  |
| Compose             | `stop_grace_period: 30s` |
| ECS task definition | `stopTimeout: 30`        |

Keep it above the sum, not equal to it.

### Schema changes

Edit [src/shared/database/schema.ts](../src/shared/database/schema.ts), then:

```bash
npm run drizzle:generate   # writes a migration into src/shared/database/migrations/
npm run db:migrate         # applies it
```

`drizzle-kit` only **generates** migrations. Applying them is always [src/shared/database/migrate.ts](../src/shared/database/migrate.ts), which uses the migrator bundled in `drizzle-orm` — the same code path in every environment, and no dev dependency needed in the production image. It takes a Postgres advisory lock and aborts if another run already holds it, so concurrent deploys cannot interleave.

`npm run dev` runs `db:migrate` for you.

### Migrations in production

Run migrations as a **one-shot container from the image being deployed**, inside the VPC (the database is not publicly reachable), before restarting the app containers:

```bash
docker run --rm --env-file /etc/app.env <image>:<sha> node dist/shared/database/migrate.js
```

The compiled migrator is invoked directly rather than through `npm run db:migrate:prod`, because the image carries no package manager — see above.

Because the migration ships in the same image as the code, the two can never drift apart. `npm run build` copies the SQL files into `dist/` (via [scripts/copy-migrations.mjs](../scripts/copy-migrations.mjs)) — `tsc` alone would not.

Rolling the app back to a previous image does **not** roll the schema back, so migrations must be backward compatible with the release before them (expand/contract: add a nullable column and backfill in one release, start writing to it in the next, drop the old one only once no running version reads it).

## Endpoints

Base URL: `http://localhost:4000`. All bodies are JSON.

| Method | Path                        | Purpose                                |
| ------ | --------------------------- | -------------------------------------- |
| GET    | `/`                         | Hello World                            |
| GET    | `/health`                   | liveness check                         |
| POST   | `/users`                    | create a user                          |
| GET    | `/users/:id`                | get a user                             |
| PUT    | `/users/:id`                | update a user's name and/or email      |
| POST   | `/meetings`                 | create a meeting (availability window) |
| GET    | `/meetings/:id`             | get a meeting                          |
| GET    | `/meetings/user/:userId`    | list a user's meetings (paginated)     |
| POST   | `/schedulings`              | book a slot inside a meeting           |
| GET    | `/schedulings/:id`          | get a scheduling                       |
| GET    | `/schedulings/host/:hostId` | list a host's schedulings (paginated)  |

Write endpoints answer `{ "success": true, "message": "..." }` with `201`; read endpoints answer `{ "data": ... }` with `200`. Ids are server-generated UUIDs — they are never taken from the request body, so read them back with a GET (or from the database) after creating.

**All datetimes must be ISO-8601 UTC strings ending in `Z`** (`2026-08-10T10:00:00Z` or `...:00.000Z`). Offsets like `-03:00` and date-only strings are rejected with `400`. They are stored as `timestamptz`, so what round-trips is the instant, not a wall-clock reading that depends on the server's timezone.

### Pagination

The two list endpoints accept `limit` and `offset`, and always cap the page whether or not the caller asks:

| Parameter | Default | Rules                                         |
| --------- | ------- | --------------------------------------------- |
| `limit`   | `20`    | integer between 1 and 100; `400` outside that |
| `offset`  | `0`     | non-negative integer                          |

```bash
curl "$BASE/meetings/user/$HOST_ID?limit=2&offset=2"
```

```json
{ "data": [ ... ], "pagination": { "limit": 2, "offset": 2, "count": 1 } }
```

`count` is how many rows came back, not the collection total (no `COUNT(*)` is issued). `count < limit` means the last page was reached. Meetings are ordered by `start_datetime`, schedulings by `schedulingDatetime`.

### Walkthrough

```bash
BASE=http://localhost:4000

# 1. a host and a guest
curl -s -X POST $BASE/users -H 'Content-Type: application/json' \
  -d '{"name":"Carlos André","email":"host@example.com"}'
curl -s -X POST $BASE/users -H 'Content-Type: application/json' \
  -d '{"name":"Guest User","email":"guest@example.com"}'
# ids are not returned — fetch them from the database, e.g.
# docker exec -it postgres-dev psql -U local_user -d scheduling_manager \
#   -c 'select id, email from "user";'

HOST_ID=...   # paste from above
GUEST_ID=...

# 2. an availability window owned by the host
curl -s -X POST $BASE/meetings -H 'Content-Type: application/json' -d "{
  \"name\":\"Sprint Planning\",
  \"description\":\"Plan next sprint\",
  \"start_datetime\":\"2026-08-10T10:00:00Z\",
  \"end_datetime\":\"2026-08-10T10:30:00Z\",
  \"meetingDurationInMinutes\":30,
  \"conferenceLink\":\"https://meet.example.com/room-123\",
  \"userId\":\"$HOST_ID\"
}"

curl -s $BASE/meetings/user/$HOST_ID     # returns the meeting, including its id
MEETING_ID=...

# 3. a booking inside that window
curl -s -X POST $BASE/schedulings -H 'Content-Type: application/json' -d "{
  \"schedulingDatetime\":\"2026-08-10T10:15:00Z\",
  \"name\":\"Intro Call\",
  \"purpose\":\"Discuss project scope\",
  \"hostId\":\"$HOST_ID\",
  \"guestId\":\"$GUEST_ID\",
  \"meetingId\":\"$MEETING_ID\"
}"

curl -s $BASE/schedulings/host/$HOST_ID
```

### Input handling

Input is **validated and rejected, never rewritten**. A request either describes something the API can store verbatim or it gets a `400` explaining what is wrong — nothing is silently mutated on the way in.

Two layers do the work:

- **Controllers** check the shape: every field must be present, of the right type, and ids must be uuids. Values are trimmed. A missing or malformed field answers `400` (`"start_datetime is required and must be a string"`, `"hostId must be a valid uuid"`) instead of blowing up further down.
- **Entities** check the content: lengths, date format, URL, and the business rules below.

Consequences worth knowing:

- **Emails are lowercased** before validation and storage, so `Carlos@Example.COM` and `carlos@example.com` are the same account rather than two.
- **Free-text fields reject HTML tags** (`400 "Name must not contain HTML"`) rather than stripping them. What is refused is a tag — `<b>`, `</div>`, `<!--` — not the `<` character, so `Ana <3 Bob` and `5 < 10` are stored exactly as sent. This API answers JSON, which a browser does not execute; escaping belongs to whoever renders the value, and storing pre-escaped text would corrupt it for every consumer.
- **`conferenceLink` must carry an `http`/`https` protocol** and may not point at loopback, private or link-local addresses — `meet.example.com` and `http://169.254.169.254/…` are both rejected.
- **Bodies are capped at 10kb**, answering `413` beyond that.

### Security headers and CORS

`helmet()` runs ahead of the body parsers, so the headers reach responses those parsers produce on their own — a `413`, a malformed body — not only responses from a route.

Its defaults are kept whole rather than trimmed to the few that act on JSON. `X-Content-Type-Options: nosniff` and `Strict-Transport-Security` do real work here; `Content-Security-Policy` and `X-Frame-Options` govern how a browser renders HTML, which this API never returns. They stay because picking a subset means re-auditing the choice on every helmet release, and because scanners and security questionnaires ask for them by name.

The cost is honest: about 660 bytes of headers on every response, roughly 250 of them CSP. Over HTTP/2 the repetition mostly disappears into header compression, but on a small JSON payload the first response of a connection carries more header than body. If that ever matters, `helmet({ contentSecurityPolicy: false })` is the one worth reconsidering.

`Strict-Transport-Security` defaults to one year with `includeSubDomains`. On `api.example.com` that only reaches that host's own subdomains; served from an apex domain it would force HTTPS on every sibling subdomain, including ones you do not control.

**CORS is enforced by the browser, not by the server.** It decides which origins may _read_ a response — `curl` and any server-to-server caller ignore it entirely, so it is never an access control. What it protects is a logged-in visitor whose browser is pointed at a hostile page.

No origin is sent by default, which is what makes a browser refuse a cross-origin read, so the middleware mounts only once `CORS_ORIGINS` lists something. The list is explicit and never reflective: `origin: true` echoes whatever origin asked, which looks like working CORS while granting every site the access the list was meant to restrict. Credentials stay off — there is no cookie to send — and turning them on alongside a reflected origin is the combination that lets any page read authenticated responses.

The `cors` middleware also sets `Vary: Origin`, without which a shared cache could hand a response authorised for one origin to another.

### Validation rules worth knowing

Hit while creating a **user**: `name` 3–50 chars, valid `email`, email must not already exist.

Hit while creating a **meeting**: `userId` must exist; both datetimes UTC; `end_datetime` after `start_datetime`; `meetingDurationInMinutes` an integer ≥ 1; `conferenceLink` a valid URL; `name` 3–50 chars; `description` 3–100 chars.

Hit while creating a **scheduling**: host, guest and meeting must all exist; the meeting must be active; `hostId` ≠ `guestId`; `schedulingDatetime` must be UTC **and fall between the meeting's `start_datetime` and `end_datetime`**; `name` 3–50 chars; `purpose` 3–100 chars; and the slot must be free — a second active booking for the same `(meetingId, schedulingDatetime)` answers `400 "This time slot is already booked"`.

Two rules are enforced by the database rather than by an application check, because a check followed by an insert is not atomic and concurrent requests slip between the two: the unique email, and the partial unique index `scheduling_active_slot_idx` that prevents double booking. Both surface as ordinary `400`s. The index is partial (`WHERE "isActive"`) so a cancelled booking frees its slot.

Foreign keys cascade on delete: removing a user removes their meetings and every scheduling they host or attend; removing a meeting removes its schedulings.

### Errors

Every failure — including unmatched routes and unexpected crashes — responds with the same shape, `{ "message": "..." }`, and the status carried by the thrown error:

| Status | Error             | Typical cause                                                                                    |
| ------ | ----------------- | ------------------------------------------------------------------------------------------------ |
| 400    | `BadRequestError` | failed validation, missing or malformed field, non-uuid id, duplicate email, malformed JSON body |
| 404    | `NotFoundError`   | unknown id, or `"Route not found"` for an unmatched route                                        |
| 413    | —                 | request body over 10kb                                                                           |
| 422    | `ValidationError` | reserved, see [src/shared/core/errors.ts](../src/shared/core/errors.ts)                          |
| 500    | —                 | unexpected                                                                                       |

An id that is not a uuid answers `400` rather than `404`: the request is malformed, and rejecting it avoids a pointless query.

Domain messages (`"Email is not valid"`) are deliberate and safe to show. Anything unexpected is **not**: driver and query errors carry table names, SQL fragments and parameter values, so `500` responses are opaque and correlate to the log through an `errorId`:

```json
{ "message": "Internal server error", "errorId": "6f1c8e4a-..." }
```

The full stack is written to the server log under that same id. Outside production the response also carries a `detail` field with the original message, so local debugging is unaffected.

An `uncaughtException` or `unhandledRejection` is not turned into a response: the process logs it and exits with code 1, leaving a restart to the orchestrator. Once either fires the process state cannot be trusted, so there is no attempt to drain first.

A database outage is **not** one of those cases. The connection pool drops the broken connections and reconnects on its own: requests that need the database answer `500` while it is down, and start succeeding again once it is back, without a restart. `/health` keeps answering `200` throughout on purpose — it reports whether this instance can serve, not whether its dependencies are up, so a database blip does not make the load balancer pull every instance out at once.

New error types belong in [src/shared/core/errors.ts](../src/shared/core/errors.ts) — controllers should not set status codes.

## Testing

The suite is integration-only: it drives a **real server over HTTP** with supertest against the Docker Postgres. There are no unit tests and nothing is mocked.

### Full run

```bash
npm test
```

This starts `npm run dev`, waits for `http://localhost:4000/health`, then runs `jest --runInBand --verbose`, and stops the containers afterwards (`posttest`). Nothing else needs to be running — but the port `4000` must be free.

### A single file or test

Because each test file targets a hardcoded `http://localhost:4000`, running jest alone requires the server to already be up. In one terminal:

```bash
npm run dev
```

In another:

```bash
npx jest tests/integration/user/post.test.ts     # one file
npx jest -t "Should return 201"                  # by test name
npm run test:watch                               # watch mode (also needs the server running)
```

Always keep `--runInBand` (the default in the npm scripts) when running more than one file: [tests/orchestrator.ts](../tests/orchestrator.ts)'s `clearDatabase()` TRUNCATEs every table in the `public` schema and is called in `beforeEach`, so parallel workers would wipe each other's fixtures.

### Writing tests

[tests/factory.ts](../tests/factory.ts) builds valid entities and inserts them straight into the database with Drizzle, bypassing the API — use it for the setup a test depends on, and hit the HTTP endpoint only for the behaviour under test:

```ts
const user = await storeUser(createUser());
const meeting = await storeMeeting(createMeeting(user.id));
```

`createUser()` returns a fixed name/email pair, so tests that need two distinct users must override the email themselves.

### Image tests

```bash
npm run test:image
```

Builds the image and asserts what only the image can answer: that it runs as a non-root user, carries `dist/` without the sources, prunes development dependencies while keeping runtime ones, ships every migration `dist/` will be asked for, runs `node` as PID 1, and drains correctly on `SIGTERM`.

They are deliberately outside `npm test` — they need Docker and a built image, and they measure in seconds. `jest.config.js` excludes `tests/image/`; [jest.image.config.js](../jest.image.config.js) runs it. CI points `IMAGE_TAG` at the image it already built and skips the local build step.

The drain test is here rather than in the integration suite because draining is terminal: `markShuttingDown()` is a one-way flag, so exercising it needs a process of its own, which is what a container is.

### Troubleshooting

- **`wait-on` times out / `ECONNREFUSED`** — port `4000` is taken, or Postgres did not become healthy. Check `docker ps` and `docker logs postgres-dev`.
- **Migration errors on `npm run dev`** — the volume holds an older schema. `npm run services:down && docker volume rm infra_pg_data` then start again.
- **Tests fail with unique-constraint errors** — a previous run left rows behind; `clearDatabase()` only runs inside the suite, so re-run `npm test` or truncate manually.

## Dependencies and vulnerabilities

### Reading an audit

```bash
npm audit --omit=dev   # what actually ships
npm audit              # everything, build tooling included
```

**`--omit=dev` is the number that matters.** Development dependencies never reach the runtime image, so a critical advisory in a test framework is a very different problem from a moderate one in the ORM. Fix the first list before worrying about the second.

An advisory names a **code path**, not just a package. `uuid`'s buffer bounds check applies to `v3`/`v5`/`v6` when a `buf` argument is passed; code calling `v4` without one is unaffected. Read the advisory before treating a version number as a verdict — and record the reasoning if you decide not to upgrade, because the next person will ask again.

### Applying a fix

| Command                        | What it does                                 | When                                         |
| ------------------------------ | -------------------------------------------- | -------------------------------------------- |
| `npm audit fix`                | upgrades within the ranges in `package.json` | always safe to try first                     |
| `npm install <pkg>@^<version>` | raises the range explicitly                  | a major bump, or to encode a security floor  |
| `npm audit fix --force`        | ignores ranges, may downgrade                | never unattended — it decides majors for you |

Prefer the explicit install over `--force`: it names the intent in `package.json` and leaves an honest diff. Packages that move together move together — `drizzle-orm` and `drizzle-kit` share a release cadence, so bumping one alone invites a generator that disagrees with the runtime.

### Upgrading safely

The lockfile is the contract. It is committed, and `npm ci` installs it exactly, so CI and the image resolve the same tree the author tested. Nothing else in this list works without that.

After any dependency change, in order — each step catches something the previous one cannot:

```bash
npx tsc --noEmit         # type-level breakage
npm test                 # behaviour, against a real database
npm run test:image       # the image still assembles and shuts down cleanly
npm run drizzle:generate # must report no schema changes after a drizzle bump
```

That last one is specific to the ORM: a generator upgrade that starts emitting different DDL for the same schema shows up as a spurious migration, and finding that at deploy time is expensive.

The Node major is pinned by `engines` and enforced by `engine-strict` in `.npmrc`, so a dependency requiring a newer runtime fails at install rather than in production.
