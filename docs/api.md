# API — Running and Testing

How to get the Scheduling Manager API running locally and how to exercise it, both by hand and through the test suite.

## Requirements

- Node.js 20+
- Docker + Docker Compose (Postgres runs in a container)

## Setup

```bash
npm install
cp .env.example .env
```

`.env` is read by both the application and `infra/docker-compose.yaml` (the Postgres container gets its credentials from the same file), so the `POSTGRES_*` values and the `DATABASE_URL` must stay consistent with each other.

| Variable | Default | Used by |
| --- | --- | --- |
| `NODE_ENV` | `development` | enables Drizzle query logging when not `production` |
| `SERVER_PORT` | `4000` | Express |
| `POSTGRES_HOST` / `POSTGRES_PORT` | `localhost` / `5432` | Postgres container |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `local_user` / `local_password` / `scheduling_manager` | Postgres container |
| `DATABASE_URL` | `postgresql://local_user:local_password@localhost:5432/scheduling_manager` | Drizzle (app + migrations) |

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

Production-ish run: `npm run build && npm start` (serves `dist/`; migrations are not applied automatically).

### Schema changes

Edit [src/shared/database/schema.ts](../src/shared/database/schema.ts), then:

```bash
npm run drizzle:generate   # writes a migration into src/shared/database/migrations/
npm run drizzle:migrate
```

## Endpoints

Base URL: `http://localhost:4000`. All bodies are JSON.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | Hello World |
| GET | `/health` | liveness check |
| POST | `/users` | create a user |
| GET | `/users/:id` | get a user |
| PUT | `/users/:id` | update a user's name and/or email |
| POST | `/meetings` | create a meeting (availability window) |
| GET | `/meetings/:id` | get a meeting |
| GET | `/meetings/user/:userId` | list a user's meetings |
| POST | `/schedulings` | book a slot inside a meeting |
| GET | `/schedulings/:id` | get a scheduling |
| GET | `/schedulings/host/:hostId` | list a host's schedulings |

Write endpoints answer `{ "success": true, "message": "..." }` with `201`; read endpoints answer `{ "data": ... }` with `200`. Ids are server-generated UUIDs — they are never taken from the request body, so read them back with a GET (or from the database) after creating.

**All datetimes must be ISO-8601 UTC strings ending in `Z`** (`2026-08-10T10:00:00Z` or `...:00.000Z`). Offsets like `-03:00` and date-only strings are rejected with `400`.

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

### Validation rules worth knowing

Hit while creating a **user**: `name` 3–50 chars, valid `email`, email must not already exist.

Hit while creating a **meeting**: `userId` must exist; both datetimes UTC; `end_datetime` after `start_datetime`; `meetingDurationInMinutes` an integer ≥ 1; `conferenceLink` a valid URL; `name` 3–50 chars; `description` 3–100 chars.

Hit while creating a **scheduling**: host, guest and meeting must all exist; the meeting must be active; `hostId` ≠ `guestId`; `schedulingDatetime` must be UTC **and fall between the meeting's `start_datetime` and `end_datetime`**; `name` 3–50 chars; `purpose` 3–100 chars.

Free-text fields (`name`, `description`, `purpose`) are sanitized with DOMPurify before validation, so HTML tags are stripped rather than rejected.

### Errors

Failures return `{ "message": "..." }` with the status carried by the thrown error:

| Status | Error | Typical cause |
| --- | --- | --- |
| 400 | `BadRequestError` | failed validation, duplicate email |
| 404 | `NotFoundError` | unknown id (also `{"error":"Route not found"}` for unmatched routes) |
| 422 | `ValidationError` | reserved, see [src/shared/core/errors.ts](../src/shared/core/errors.ts) |
| 500 | — | unexpected; shape is `{ "status": "error", "message": "Internal server error - ..." }` |

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
