# API — Running and Testing

How to get the Scheduling Manager API running locally and how to exercise it, both by hand and through the test suite. For how the code is organized, see [architecture.md](architecture.md).

## Requirements

- Node.js 20+
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
| `POSTGRES_HOST` / `POSTGRES_PORT`                     | `localhost` / `5432`                                                       | Postgres container                                                          |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `local_user` / `local_password` / `scheduling_manager`                     | Postgres container                                                          |
| `DATABASE_URL`                                        | `postgresql://local_user:local_password@localhost:5432/scheduling_manager` | Drizzle (app + migrations)                                                  |
| `DATABASE_POOL_MAX`                                   | `10`                                                                       | connection pool ceiling **per container**                                   |
| `SHUTDOWN_DRAIN_DELAY_MS`                             | `0` locally, `5000`+ behind a load balancer                                | how long `/health` reports unhealthy before connections stop being accepted |
| `SHUTDOWN_TIMEOUT_MS`                                 | `15000`                                                                    | grace period for in-flight requests before sockets are forced closed        |

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

### Shutdown

On `SIGTERM`/`SIGINT` the server drains instead of dying: `/health` starts answering `503`, and only after `SHUTDOWN_DRAIN_DELAY_MS` does it stop accepting connections. That window is what lets a load balancer deregister the instance before its in-flight requests are cut. In-flight work then gets up to `SHUTDOWN_TIMEOUT_MS` to finish before sockets are forced closed, and the connection pool is closed last.

This only works if the Node process actually receives the signal — in a container that means an exec-form `CMD` (or `docker run --init`), so Node is PID 1.

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
docker run --rm --env-file /etc/app.env <image>:<sha> npm run db:migrate:prod
```

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

### Troubleshooting

- **`wait-on` times out / `ECONNREFUSED`** — port `4000` is taken, or Postgres did not become healthy. Check `docker ps` and `docker logs postgres-dev`.
- **Migration errors on `npm run dev`** — the volume holds an older schema. `npm run services:down && docker volume rm infra_pg_data` then start again.
- **Tests fail with unique-constraint errors** — a previous run left rows behind; `clearDatabase()` only runs inside the suite, so re-run `npm test` or truncate manually.
