# Observability and monitoring

Five words that are used as synonyms and are not. The distinction is worth holding because each one is bought and built differently, and the common failure is to install a log aggregator, call it observability, and still be unable to answer the question an incident actually asks.

## The words

### Telemetry — the data

What a system emits about itself. Conventionally three shapes:

| Shape      | Is                                                                                   | Answers                                |
| ---------- | ------------------------------------------------------------------------------------ | -------------------------------------- |
| **Metric** | a number aggregated over time                                                        | how much, how often, how slow          |
| **Log**    | a record of one discrete event                                                       | what happened, once, with detail       |
| **Trace**  | one request decomposed into spans, stitched across processes by a propagated context | where the time went, and in what order |

They are not interchangeable. A metric cannot tell you which user was affected; a log cannot tell you the p95 without reading all of them.

### Instrumentation — producing it

The act of making the system emit telemetry: code you add, or an agent that injects it. No instrumentation, nothing to observe. It is the part with a maintenance cost, which is why the shape of what you emit matters more than the volume.

### Monitoring — known unknowns

Watching known signals against known thresholds, and alerting. It answers questions decided in advance: is the error rate above 1%, is the disk full, did the certificate expire.

Monitoring is only as good as the question you thought to ask before the incident.

### Observability — unknown unknowns

A **property of the system**, not an activity: whether you can answer questions you did not anticipate, from what it already emits, **without deploying new code to investigate**. The term comes from control theory — a system is observable when its internal state can be inferred from its outputs.

> Monitoring tells you **that** something is wrong. Observability is what lets you find out **why**, when the cause is something nobody had a dashboard for.

The practical test is one question: when the next incident is something you have never seen, will you be adding `console.log` and deploying? If yes, the system is not observable, however many dashboards exist.

### Logs and error management are not the same thing

A log is append-only: one record per event, valuable in proportion to how **structured** it is. Error management is a layer above exceptions that captures the stack and its context, **groups identical occurrences by fingerprint**, counts affected users, tracks first and last seen, and alerts when a resolved error returns.

The difference is deduplication. The same `TypeError` a thousand times is a thousand log lines and **one** item in an error tracker — with a count on it.

### Analytics — the only one not about the system

Analytics is about **user behaviour**: how many people created a meeting, where they abandoned the booking flow, which endpoint a customer actually uses. Different audience (product, not operations), different horizon (weeks, not minutes), different tolerance for loss.

That last one is the reason to keep the pipelines separate: sampling at 10% and delivering an hour late is fine for analytics and useless during an incident.

## The axis

|                  | Produces    | Consumes             | About             |
| ---------------- | ----------- | -------------------- | ----------------- |
| Instrumentation  | ✔           |                      | the system        |
| Telemetry        | is the data |                      | the system        |
| Monitoring       |             | ✔ prepared questions | the system        |
| Observability    |             | ✔ new questions      | the system        |
| Error management | ✔           | ✔                    | failures, grouped |
| Analytics        | ✔           | ✔                    | people            |

## Examples

### One event, three shapes

A `POST /schedulings` that took 800 ms and failed on a constraint violation.

**As a metric** — cheap, aggregable, keeps forever, names nobody:

```
http_request_duration_seconds{route="/schedulings",method="POST",status="409"}  0.8
```

**As a log** — one record, full detail, expensive at volume:

```json
{
  "level": "warn",
  "msg": "scheduling rejected",
  "route": "POST /schedulings",
  "status": 409,
  "duration_ms": 800,
  "reason": "overlapping_booking",
  "meeting_id": "0b7d…",
  "request_id": "3f2a…"
}
```

**As a trace** — the same request, decomposed, which is the only shape that answers _where the 800 ms went_:

```
POST /schedulings ─────────────────────────────────────── 800ms
  ├─ parse and validate ──                                   4ms
  ├─ db: select meeting ──────────                          120ms
  ├─ db: insert scheduling ───────────────────────────────  650ms  ← the answer
  └─ serialise response ─                                     2ms
```

Without the trace, "the endpoint is slow" is where the investigation stops.

**Nothing in that example needs a second service.** Every span is inside one process: middleware, two queries, serialisation. That is the distinction worth holding, because the two halves of tracing have very different prices:

|                              | Buys                                           | Costs                                                           |
| ---------------------------- | ---------------------------------------------- | --------------------------------------------------------------- |
| **Spans within one process** | the breakdown above — which layer, which query | one dependency, auto-instrumented                               |
| **Distributed tracing**      | the same across service boundaries             | a context propagated through every hop, and a boundary to cross |

The second is what a single service has no use for. The first answers the most common question production asks — _which part of this request is slow_ — and is available long before there is a second component to blame. Conflating them is what makes tracing look like something to defer until there are microservices.

### Structured versus unstructured, in this codebase

[errorHandler.ts](../src/shared/core/errorHandler.ts) emits an unhandled failure as two calls:

```ts
console.log(`\n[InternalError]: errorId=${errorId}`);
console.error(err);
```

Read on a terminal that is fine. Read by a collector it is three problems:

- **Two records, not one.** The id and the stack are separate lines, joinable only by adjacency — which stops being reliable the moment two requests fail at once.
- **The leading `\n` emits a blank record**, because most shippers split on newline.
- **Nothing is a field.** Finding every failure of one route means a substring search, and `errorId=3f2a…` is text rather than something to group by.

The structured form is the same information with the joins already made:

```json
{
  "level": "error",
  "msg": "unhandled error",
  "error_id": "3f2a…",
  "route": "POST /schedulings",
  "err": { "type": "TypeError", "message": "…", "stack": "…" }
}
```

**The `errorId` is already the right idea.** It is returned to the client and written to the log, so a user's complaint becomes a lookup instead of a guess. What it lacks is a field to look it up in, and somewhere the log outlives the container.

### A monitoring question and an observability question

- **Monitoring:** _"is the 5xx rate above 1% over five minutes?"_ — a known signal, a threshold chosen in advance, an alert. Answerable by a counter.
- **Observability:** _"why do only bookings for meetings created before the timezone change fail, and only for hosts with more than 50 availability windows?"_ — nobody built a dashboard for that, and the answer exists only if the request's attributes were recorded alongside its outcome.

The second is the one that decides how long an incident lasts, and the shape of the instrumentation decides whether it is answerable at all.

### What deduplication buys

A bad release throws the same exception on every request. In a log:

```
14:02:01 TypeError: Cannot read properties of undefined
14:02:01 TypeError: Cannot read properties of undefined
… 40 000 more
```

In an error tracker, one entry: `TypeError · 40 002 events · 118 users · first seen 3 min ago · release abc123`. The count and the release are what turn "something is wrong" into "roll back to the previous SHA" — see [rollback.md](rollback.md).

### Analytics, for contrast

```
event: scheduling_created
properties: { host_plan: "free", lead_time_hours: 26, source: "public_link" }
```

Nothing here helps during an incident, and none of it needs to arrive within the minute. It answers whether the product works, not whether the server does.

## What this system emits, and what it leaves unanswered

| Source                       | Emits                                                               | Where it goes                      |
| ---------------------------- | ------------------------------------------------------------------- | ---------------------------------- |
| Application                  | one JSON record per event, carrying the request id that produced it | CloudWatch Logs, and a local cache |
| Connection pool              | idle-client errors, so a dropped connection is not fatal            | CloudWatch Logs, and a local cache |
| Reverse proxy access log     | **4xx and 5xx only** — successful traffic is filtered out           | CloudWatch Logs, and a local cache |
| Docker daemon                | caps the local cache each container keeps                           | the instance's disk                |
| Probes (`/health`, `/ready`) | a binary verdict, polled                                            | the proxy and the deploy gate      |
| Billing alarm                | a threshold on spend                                                | email                              |

Three consequences follow, and each is a design trade rather than an oversight:

**Shipping is what makes the host disposable.** Replacing an instance is routine — it is how a template change is delivered and how the operating system is upgraded — so logs kept only on its disk would be lost on a normal operation rather than in a disaster. The `awslogs` driver sends them as they are written, and the daemon keeps a local cache alongside, so `docker logs` and the deploy gate's failure output still work even though the remote driver cannot be read back.

**The socket proxy is deliberately not shipped.** It narrates every discovery poll the reverse proxy makes, which is volume without information — and ingestion is billed by the gigabyte.

**Filtering the access log to 4xx and 5xx is the correct default and has a blind spot.** Successful traffic at volume is most of the log and answers nothing a metric would not — but data taken through requests that returned `200` leaves no record at all, which is exactly the shape of a credential-abuse incident.

**Rate limiting has no counterpart in telemetry.** The proxy rejects with `429` and the fact is in the access log; nothing aggregates it, so a client being throttled continuously and a one-off burst look the same until someone reads the file.

The trigger for changing all three is the same and is worth stating plainly: **the first real customer record entering the database.** Before that, losing an instance's history costs nothing. After it, an investigation that starts with nothing is a liability rather than an inconvenience.

## What to add first, and in what order

Ordered by what each step unlocks, not by effort. Every step below is a decision about shape, and the shape is what cannot be added back later.

### 1. Structured logging

One JSON record per event, with `request_id`, `route`, `status`, `duration_ms` and `error_id` as **fields**. Everything downstream — search, grouping, alerting, metric extraction — depends on the records being parseable, and nothing downstream can add the fields back.

`pino` is the reference choice in Node: JSON-first and fast enough not to appear in the p99. Two settings are not optional:

```ts
pino({
  level: process.env.LOG_LEVEL ?? "info",
  // Logs are copied to places with weaker access control than the database they
  // came from, and redaction added later does not reach what already shipped.
  redact: ["req.headers.authorization", "req.headers.cookie", "*.password"],
});
```

**Emit through one seam.** A single module the application logs through is what makes destination, format and level changeable without touching call sites — the same reason [conn.ts](../src/shared/database/conn.ts) is the only place that knows how the database is reached.

### 2. A request id, propagated

Generated at the edge or accepted from the proxy, attached to every line the request produces, and returned in the response. It is what makes a log searchable by incident rather than by time.

The propagation is the part with a design consequence. Threading a logger through every constructor would put a transport concern in the domain layer. `AsyncLocalStorage` — in Node, not a dependency — keeps it out: a middleware opens the context, the logger reads from it, and **a use case never learns that logging exists**.

The `errorId` in [errorHandler.ts](../src/shared/core/errorHandler.ts) is already half of this: returned to the client and written to the log, so a complaint becomes a lookup. What it lacks is a field to look it up in.

### 3. Ship it off the instance

The property that matters is surviving the host, so any destination beats the local disk. The cheapest correct step needs **no application change at all**, because the process already writes to stdout — the container log driver does it:

```json
{
  "log-driver": "awslogs",
  "log-opts": {
    "awslogs-region": "us-east-1",
    "awslogs-group": "/scheduling-manager",
    "awslogs-create-group": "true"
  }
}
```

Plus `logs:CreateLogStream` and `logs:PutLogEvents` on the instance role. Two traps come with it, and both are defaults:

- **A log group never expires unless told to.** Set a retention, or storage grows for the life of the account.
- **Ingestion is billed per GB.** A `debug` level left on in production is the usual way that bill arrives.

### 4. Error management

Grouping and release-tagging are what connect a spike to the deploy that caused it. The release tag is free here, because a release already **is** a commit SHA:

```ts
Sentry.init({
  release: process.env.APP_RELEASE,
  environment: process.env.NODE_ENV,
});
```

That completes the pair rollback depends on: the tracker says _this error appeared in `c5ee186`, 40 000 events, 118 users_, and `scripts/release.sh <previous sha>` is the answer — see [rollback.md](rollback.md). Without the tag there is an error and no culprit.

#### Configuring it

The DSN is the only thing the tracker needs, and the application runs without it: absent, [errorTracking.ts](../src/shared/core/errorTracking.ts) initialises nothing. That is what keeps a third-party account from being a requirement for running the project, and it is why every local run and every test reports nowhere.

| Where      | How                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------- |
| Production | a `SecureString` at `/<project>/sentry-dsn`, read at deploy time and written to `app.env` |
| Local      | left empty, so nothing is reported and the free quota is not spent on development         |

The parameter is read with a tolerant lookup: an absent DSN must not be a reason a release cannot ship. Delivering it needs the instance rebuilt, because the deploy script and the Compose file come from user data — [ec2.md](ec2.md#the-image-tag-does-not-live-in-user-data).

**The region is chosen when the organisation is created and cannot be changed afterwards.** For personal data under a Brazilian or European obligation that is a decision, not a default.

#### What the SDK collects, and the option that reverses it

`dataCollection` names every field, including the ones already off, and that is not verbosity. The SDK resolves the object against one of two bases: **absent**, it uses the restrictive mapping behind `sendDefaultPii: false`; **present** — even holding a single field — it switches to permissive defaults, and every field left out reverts to collecting.

So `dataCollection: { stackFrameVariables: false }` turns off local variables and turns **on** request bodies, cookies, user info and query values. The narrower-looking edit is the wider one.

`stackFrameVariables` is why the block exists at all. It stays `true` even under `sendDefaultPii: false`, and the local-variables integration ships in the default set, so an exception inside a use case sends that frame's locals — which is the DTO, with the name and the email in it.

#### In the tracker's own settings

Three things the default project does not do:

- **Replace the "any new issue" rule.** It is noise the moment there is traffic, and an alert that fires without consequence teaches people to ignore the next one. Two rules earn their place: a new issue **or a regression** on the latest release, which is the signal a rollback acts on; and a known issue crossing a volume threshold, which the first rule cannot see because the issue is not new.
- **Rate-limit the client key.** `captureError` runs on every `500`, so a release that cannot reach the database spends a monthly quota in minutes — during the incident, and then there is no quota left to watch it with.
- **Add this API's free-text fields to server-side scrubbing.** `email`, `name`, `purpose` and `description` are not in anyone's default list. Client-side redaction runs before the send and this runs after; the point of both is that a path escaping one is still caught by the other.

### 5. OpenTelemetry — spans and metrics are one install

`@opentelemetry/auto-instrumentations-node` instruments Express and `pg` without touching application code, and emits both shapes at once. They are not sequential steps.

What earns it on a single service is not distributed tracing, which has nothing to stitch. It is that the `pg` instrumentation times **every query**, which is where the answers to N+1 and slow-query questions come from — and the only way to know the database is at fault before guessing.

Being vendor-neutral is the second reason: instrument once, and the backend becomes configuration.

**What not to do: run the backend on the same instance.** A Prometheus and Loki stack there would compete with the application for 2 GB of memory, and the observer would die with the observed — the host is disposable by design.

### 6. Alarms on symptoms, not causes

High CPU is not an incident; a slow request is. An alarm that fires without consequence teaches people to ignore the next one, which is the same reason the pipeline's thresholds are set where they are — see [ci-cd.md](ci-cd.md#why-each-gate-sits-where-it-does).

| Alarm                  | Why                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5xx rate               | the symptom                                                                                                                                                                     |
| p95 latency            | the symptom a 5xx rate misses                                                                                                                                                   |
| `/ready` failing       | the dependency, not the process                                                                                                                                                 |
| **CPU credit balance** | a burstable instance in `unlimited` mode bills surplus CPU rather than throttling, so absorbed traffic converts to an invoice — and a spending alarm reports it after the money |
| **Disk usage**         | released images accumulate, because immutable tags mean none is ever dangling — [rollback.md](rollback.md#why-it-is-fast-and-what-that-costs)                                   |

**Latency must be a distribution.** Ninety-nine requests at 10 ms and one at 3 s average to 40 ms, and the number describing the experience is the p99. Emit a histogram, never a gauge.

## What it costs

The free allowances below are the reason this order is affordable; the numbers move, so treat them as the shape of the pricing rather than the price.

| Item                                   | Free allowance | Beyond it                       | What goes wrong                                    |
| -------------------------------------- | -------------- | ------------------------------- | -------------------------------------------------- |
| CloudWatch Logs ingestion              | 5 GB/month     | ~$0.50/GB                       | a debug level in production                        |
| CloudWatch Logs storage                | 5 GB           | ~$0.03/GB-month                 | **retention defaults to never expire**             |
| CloudWatch custom metrics              | **10**         | **~$0.30 per metric per month** | **cardinality — see below**                        |
| CloudWatch alarms                      | 10             | ~$0.10 each                     | —                                                  |
| Logs Insights queries                  | —              | ~$0.005/GB scanned              | negligible at this size                            |
| Error tracker (Sentry and equivalents) | an event quota | per event                       | —                                                  |
| Managed metrics backends               | a series quota | per series                      | —                                                  |
| OpenTelemetry SDK                      | free           | —                               | its CPU overhead is billed on a burstable instance |

**Cardinality is the line item that surprises people.** In CloudWatch a "metric" is a unique combination of name and dimensions, so one latency metric dimensioned by route and status is not one metric — with nine routes and five status codes it is forty-five, priced individually. That is more than the instance it observes.

Two ways out, and the second is cheaper than it sounds:

- Keep CloudWatch metrics **undimensioned** — aggregate only — and accept that per-route detail lives elsewhere.
- Get per-route detail from **queries over the structured logs**, which already carry `route`, `status` and `duration_ms`. Computing a p95 by route on demand costs a fraction of a cent per GB scanned and creates no metric at all.

A metrics backend priced per **series** rather than per metric inverts this: dimensions become cheap and the free allowance is measured in thousands. That is the reason to keep step 5 vendor-neutral.

## Which question belongs to which discipline

Capacity-planning questions and observability questions are often the same sentence in a different tense. "How many requests per second do we **expect**" is estimation, answered before code exists; "how many requests per second **are there**" is a counter.

| Question                                      | As a forecast                                         | As a measurement                                          |
| --------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------- |
| How many users are there?                     | capacity planning                                     | **analytics** — it is about people, not the system        |
| How much data will we handle?                 | capacity planning                                     | a growth gauge, feeding cost                              |
| How many requests per second?                 | capacity planning                                     | **monitoring** — the _rate_ signal                        |
| What is the read-to-write ratio?              | **design** — it decides caching, replicas and indexes | a derived metric, per route and method                    |
| Resource usage, cost                          | capacity planning                                     | **monitoring** and cost management                        |
| How long does a request take?                 | —                                                     | **monitoring** — the _duration_ signal, as a distribution |
| How much CPU and memory does one request use? | —                                                     | **profiling** — not a metric                              |

Two of those rows carry the whole point.

**The first four are system-design questions.** They are the back-of-the-envelope estimate made before anything is built, which is why they cluster in design discussions. Observability answers the same questions later, with measurements instead of guesses — and the guesses are what decide the architecture, so being wrong there is more expensive than being wrong about the measurement.

**The last one is not answerable by metrics, and that is the subtle one.** CPU and memory are measured per **process**; attributing them to a single request needs sampling of stacks over time — continuous profiling, flame graphs. It is a different class of tool, and it is what separates "this endpoint is slow" from "this endpoint is slow **in this function**".
