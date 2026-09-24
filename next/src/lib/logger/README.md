# Logger

## Purpose

The repository-wide, structured logging foundation. Every part of the application — controllers,
services, jobs, integrations — reports through this instead of `console.*` directly.

This replaces three independent, hand-rolled seams that each grew in isolation because "the
repository has no logging abstraction and this does not justify introducing one" was true three
separate times: `lib/rate-limit/events.ts`, `modules/mcp/observability/events.ts`, and
`modules/notifications/observability/log.ts`. Those modules keep their own typed event shapes
(`RateLimitEvent`, `McpEvent`) — that domain modeling is worth keeping — but their transport now
delegates here instead of reimplementing `console`/sink-swap plumbing a third and fourth time.

## Using it

```ts
import { logger } from "@/lib/logger";

logger.info("competition.published", { competitionId });
logger.warn("cache.miss", { key });
logger.error("payment.webhook_failed", error, { webhookId });

const requestLogger = logger.child({ tool: "search_competitions" });
requestLogger.info("mcp.tool.succeeded", { durationMs });
```

- **`event`** is a stable string, `area.thing_happened`, past tense — e.g. `generation.created`,
  `delivery.pass`, `jobs.failed`. Stable names matter more than pretty ones: they are what a log
  query is written against. Not a shared enum — a repo-wide closed union would have to be edited by
  every feature that ever adds an event, which is exactly the shared-file bottleneck
  [`folder-structure.md`](../../../../docs/architecture/folder-structure.md) designs modules to
  avoid. A module that wants a closed set of its own event names (like `RateLimitEvent`/`McpEvent`)
  is free to keep one and pass its values through as `event` here.
- **`fields`** is whatever you have on hand — ids, enums, counts. It is sanitized automatically
  before it reaches a sink (see Sanitization below); you do not need to pre-redact anything.
- **`error` on `logger.error()` is required, not folded into `fields`.** This forces every
  error-level call to carry a real cause, and lets normalization (stack, `AppError` fields, `.cause`
  chain) happen once, here, instead of every call site re-implementing
  `error instanceof Error ? error.message : String(error)`.
- **`logger.child(bindings)`** returns a logger that merges `bindings` into every subsequent call —
  for a `requestId`, a `tool` name, or any value you'd otherwise repeat at every call site in one
  function.

## When to log, and at what level

| Level | Use for |
|---|---|
| `info` | Something happened that is normal, expected, and worth being able to query later — a notification generated, a rate-limit check passed, a job completed. |
| `warn` | A degraded-but-handled condition — a store fell back to fail-open, a provider fell back to a fake, a cache miss forced a slower path. |
| `error` | Something failed that a human may need to look at. Always pass the real `error`. |

Not every `console.log` in the codebase today is a log event waiting to be migrated. A one-off debug
line, a CLI script's actual output (`scripts/*.ts`, where `console.log` **is** the product), and a
browser-side `console.error` in a React component are different concerns — see
[`docs/architecture/decisions/logging.md`](../../../../docs/architecture/decisions/logging.md) for
the reasoning on what did and didn't migrate.

## What must never be logged

Sanitization (`sanitize.ts`) redacts values by key name automatically — `password`, `token`,
`secret`, `authorization`, `cookie`, `apiKey`, `privateKey`, `credential`, and a few more (see the
file's own doc-comment for the exact list and why each entry is there). This runs unconditionally;
there is no opt-out, because the safe path has to be the only path, not one a caller can forget.

What it does **not** catch, because a key-based redaction pass cannot safely catch it without
constant false positives or false negatives:

- **Request/response bodies and other free text a user or an external system authored.** Logging
  `{ body: req.body }` or an entire email's text can carry a password-reset link, a webhook secret
  embedded in a payload, or arbitrary user PII — none of which is a field named `password`. Log
  specific, named fields you actually need (`competitionId`, `userId`), never a whole body/payload
  object.
- **A raw request or response object.** Headers include `Authorization`/`Cookie`; log the fields you
  need off of it, not the object itself.

`lib/auth/email.ts`'s stub email sender is the concrete, present-day example of the mistake this
guidance exists to prevent: it currently logs the recipient address and the full message body —
including live password-reset and verification links — via `console.log`. Fixing that stub is
outside this foundation's scope, but it is the shape of call site this module's guidance is written
against.

## Errors

`logger.error(event, error, fields)` normalizes `error` automatically:

- A `lib/errors` `AppError` (or subclass) yields `code`, `category`, `retryable`, `status`, `message`,
  `stack`, and its `.cause` chain, normalized the same way, up to 5 levels deep.
- A plain `Error` yields `message`, `name`, `stack`, and `.cause` if present.
- Anything else (`string`, a plain object, `undefined`) degrades to a safe shape rather than throwing.

**This is diagnostic-only.** `AppError.details` is what `createErrorResponse`/`ErrorHandler` are
allowed to send back to an API caller. `logger.error` deliberately captures *more* than that
(message, stack, the full cause chain) for operators — that gap between what's logged and what's
returned is the boundary that must never blur. Nothing about this logger changes what a client
receives; it only changes what an operator can see afterward.

## Request context

`logger.info`/`.warn`/`.error` automatically include `requestId` (and `actorId`, once known) for any
call made during an HTTP request, with no need to thread either through a service or repository call
chain by hand.

- `requestId` is established once per request, in `Route.execute` (`lib/http/route.ts`), for every
  ordinary API route, and independently in each internal/cron route
  (`internal/tick`, `internal/assets/reconcile`) that bypasses `Route.execute`.
- `actorId` is set by `SessionService` (`lib/auth/session.ts`) the moment a session actually
  resolves to a user — inside `getActor`/`getStrictActor`/`getOptionalActor`, using the id that
  lookup already produced. The logger itself never calls `SessionService`, never resolves a session,
  and has no opinion about authorization; it only records an id that request-handling code already
  had for its own reasons. This keeps the logger from becoming a second place identity is decided,
  and avoids a duplicate session lookup purely for logging's sake.

Uses `AsyncLocalStorage`, on the same basis already established for this repository by
`lib/rate-limit/response-context.ts`: every route handler runs on the default Node.js serverless
runtime (no route sets `export const runtime = "edge"`, and the app already requires Prisma + Better
Auth, neither edge-compatible), so `node:async_hooks` is available and reliable here.

**Do not import `@/lib/logger` from a client component.** Its request-context module uses
`node:async_hooks`, a server-only Node API. This mirrors `lib/http/index.ts`'s existing exclusion of
`Route` from its client-reachable barrel — see that file's comment for the identical reasoning.
Application server code (controllers, services, jobs, route handlers) is unaffected; this only
matters for code that ends up in a browser bundle.

## Provider independence

The one place this module touches `console` is `sink.ts`. Everything else produces a fully-formed,
sanitized `LogRecord` and hands it to whatever sink is currently installed.

```ts
import { setLogSink } from "@/lib/logger";

setLogSink((record) => {
  // ship `record` to a hosted logging/observability provider
});
```

Introducing a third-party logging or observability provider later is exactly one `setLogSink(...)`
call at application startup — no call site anywhere in the application (`logger.info`/`.warn`/
`.error`/`.child`) changes. `LogRecord`'s shape (`level`, `event`, `timestamp`, a flat sanitized field
bag with a normalized error folded in when present) is deliberately already close to what a hosted
structured-logging ingest expects, so an adapter is a translation, not a redesign. A sink is a plain
function — the only operation a destination ever needs is "accept one record" — so composing two
destinations (console AND a future provider) is a sink that fans out to both; nothing about this
module needs to change to support that.

A sink may return `void` or `Promise<void>` — most hosted logging SDKs batch/flush asynchronously, so
this is already accounted for rather than something a future provider would need the sink contract
redesigned to support. `logger.*()` calls remain fire-and-forget either way; an async sink's rejection
is caught internally rather than surfacing as an unhandled rejection, and a slow sink never makes an
application code path wait on it. A provider that needs a stronger delivery guarantee than
best-effort (e.g. flushing before a serverless function suspends) handles that inside its own sink
adapter — using the platform's own `waitUntil` or equivalent — rather than `lib/logger` growing an
opinion about it.

`setLogSink`/`resetLogSink` are also how this module's own tests, and the tests of anything built on
top of it (`lib/rate-limit`, `modules/mcp`, `modules/notifications`), assert on emitted log lines
without depending on `console` output.

## What this module deliberately does not do

- No log levels beyond `info`/`warn`/`error`. Nothing in the audit that led to this module showed a
  need for `debug`/`trace`, and adding levels nothing calls would be exactly the over-engineering
  this foundation is meant to avoid.
- No database persistence. Kizunia's operational logs are not a durable business record — see
  [`docs/architecture/decisions/logging.md`](../../../../docs/architecture/decisions/logging.md) for
  why that's a deliberate line, not an oversight, and how it differs from genuine domain/audit events
  (e.g. "an administrator deleted a competition"), which belong to their own domain, not to this
  module.
- No metrics, tracing, or dashboards. This is a logging foundation, not an observability platform.
  See the ADR for what a future addition in that direction would build on top of, rather than instead
  of, this module.
