# A Centralized Logging Foundation

## Status

Accepted — 2026-09-20. Implemented — `next/src/lib/logger/`.

---

# Context

Kizunia had no shared logging abstraction. Three independent modules each solved the same problem in
isolation, at three different points in the project's history:

- `lib/rate-limit/events.ts`
- `modules/mcp/observability/events.ts` ("Deliberately modelled on `src/lib/rate-limit/events.ts`")
- `modules/notifications/observability/log.ts`

Every one of the three carries its own version of the same sentence: *"Kizunia has no logging
framework yet... and this does not justify introducing one."* Each is a typed event shape, JSON
serialized to `console`, with a swappable sink for tests. That is three slightly different
implementations of one idea, built by three different features that each independently concluded a
shared one wasn't worth building yet.

Separately, `ErrorHandler.handle()` (`lib/errors/error-handler.ts`) — the single chokepoint every
unclassified exception in the entire REST API passes through — did nothing with an unrecognized error
but `console.error(error)`: no structure, no request correlation, no sanitization.

A concrete sensitive-data risk exists today: `lib/auth/email.ts`'s stub email sender logs the
recipient address and the full message body — including live password-reset and verification links
— via plain `console.log`. This is not fixed by this change (rewiring the email stub is a separate,
unrelated piece of work), but it is the concrete negative example the new logger's sanitization
guidance is written against.

No logging library (`pino`, `winston`, or similar) was ever added to this repository — this is a
from-scratch decision, not a migration away from an existing choice.

---

# Decision

**A single, repository-wide logging module (`lib/logger`) is the one supported way to emit an
operational log line in Kizunia, going forward.**

Four commitments follow.

### 1. A small function-based API, not a class instance

`logger.info(event, fields)` / `.warn(...)` / `.error(event, error, fields)` / `.child(bindings)` —
bare functions, matching how every logging call in this codebase already worked
(`logNotificationEvent`, `emitMcpEvent`, `emitRateLimitEvent` are all plain imports; nothing in this
repository constructs a logger via dependency injection). `event` is a stable, free-form
`area.thing_happened` string, not a closed enum — a repo-wide union would have to be edited by every
feature that ever adds an event, which is the shared-file bottleneck
[`folder-structure.md`](../folder-structure.md) already designs modules to avoid.

### 2. Diagnostic logging is layered strictly outside the API-response boundary

`logger.error` normalizes an `AppError`'s `code`/`category`/`retryable`/`status`, its message, its
stack, and its full `.cause` chain — strictly more than `AppError.details`, which is the only part of
an error `createErrorResponse`/`ErrorHandler` are allowed to send to a client. The logger never
changes what an API response contains; it only changes what an operator can see afterward. This
boundary already existed in the codebase (`details` vs. everything else on `AppError`) — the logger
formalizes it rather than introducing it.

### 3. Sanitization is unconditional, not opt-in

Every field passed to `logger.*()` is redacted by key name (`password`, `token`, `secret`,
`authorization`, `cookie`, `apiKey`, `privateKey`, `credential`, and related names — see
`lib/logger/sanitize.ts`'s own doc-comment for the full list and why each entry traces to a real
secret surface in this codebase) before it reaches a sink. There is no bypass. "The safe path is the
convenient path" is a requirement, not a suggestion, and every prior ad hoc seam already had to think
about this piecemeal — rate-limit omits subject identity entirely, MCP documents a "never log this"
list in a comment, and the auth email stub is the standing negative example of what happens with no
mechanism at all.

### 4. The sink is the only provider-coupling point, and it stays that way

`setLogSink`/`resetLogSink` swap the one function every log record passes through. This is not new —
it is the same mechanism all three prior seams already used for exactly this purpose — generalized to
the whole application instead of reinvented per module. Introducing a hosted logging/observability
provider later is one `setLogSink(...)` call at startup; no application call site changes. `LogRecord`
(level, timestamp, event, a flat sanitized field bag with a normalized error folded in) is close to
what a hosted structured-logging ingest already expects, so a future adapter is a translation, not a
redesign.

---

# Consequences

### Accepted costs

**A second `AsyncLocalStorage` store, alongside the rate-limit one.** `lib/logger/context.ts` reuses
the exact runtime justification `lib/rate-limit/response-context.ts` already established (no route in
this repository sets `runtime = "edge"`; Prisma and Better Auth already require Node) rather than
re-arguing it, but it is still a second store, and a second place `Route.execute` sets something up
before running the handler. This was judged worth it because request correlation for ordinary API
routes did not exist at all before this change — the only prior mechanism was MCP's own, separate,
module-local `requestId`.

**Three modules now depend on `lib/logger` instead of `console` directly.** `lib/rate-limit/events.ts`,
`modules/mcp/observability/events.ts`, and `modules/notifications/observability/log.ts` all changed —
each keeping its own typed event shape and public function names exactly as they were, with only the
transport underneath swapped. Every existing call site in all three modules is unchanged.

**A barrel-export hazard, discovered and fixed during implementation.** `lib/errors/index.ts` used to
re-export `ErrorHandler`, and that barrel is reachable from client components (via
`ApiResponse`/`HttpStatus` usage in pages). Once `ErrorHandler` started importing `lib/logger` (for its
unclassified-error fallback), the client bundle broke: `lib/logger`'s `AsyncLocalStorage`-based context
module doesn't bundle for the browser. Fixed the same way `Route` was already excluded from
`lib/http/index.ts`'s barrel for the identical reason: `ErrorHandler` is no longer re-exported from
`lib/errors`'s main barrel, and its two call sites (`lib/http/route.ts`, and the one test that exercises
it directly) import it from `@/lib/errors/error-handler` instead. This is a second instance of a
pattern the codebase already had one example of, not a new kind of problem.

### Explicitly not accepted

**A fourth structured-logging module, "just for the new stuff."** The three existing seams needed to
migrate onto this, not sit beside it — a codebase with four independent logging implementations after
this change would be a worse outcome than the three it started with.

**Log levels, transports, or persistence nothing in the audit asked for.** No `debug`/`trace` level,
no database-backed log store, no message queue, no metrics or tracing SDK. "Enterprise-grade" here
means correctness, security, and a clean extension point — not infrastructure adopted because the word
sounds like it should exist yet.

**Turning this into an audit-log system.** A durable business record — "an administrator deleted a
competition" — is a different concern from an operational log line, and belongs to its own domain
model if and when Kizunia needs one, not to this module. Nothing here recommends that the two be
conflated.

### What this makes possible

Every future domain — payments, subscriptions, webhooks, background processing — reports through the
same `logger.info`/`.warn`/`.error` calls every existing module now uses, with sanitization and
request correlation for free, and without needing to invent a fourth seam the way MCP and
notifications each independently had to. Adding a real third-party logging/observability provider
later is an infrastructure change (one sink function, one `setLogSink` call), not an application-wide
rewrite.

---

# Alternatives considered

**Adopting a third-party logging library now (pino, winston, or similar).** Rejected: nothing in the
audit demonstrated a need this repository's own `console`-based approach — already proven across three
modules and Vercel's log capture — doesn't meet today. Provider independence is achieved by the sink
boundary, not by pre-committing to a specific library's API repository-wide.

**Leaving the three existing seams as they are and only fixing `ErrorHandler`.** Rejected: it would
leave the fragmentation in place and add a fourth pattern rather than resolving the three that already
existed, directly contradicting the reason this work was undertaken.

**A class-based `Logger` with constructor injection.** Rejected: nothing else in this codebase is
structured this way (no DI container exists), and every prior logging call in this repository was
already a bare function import. Matching that convention keeps the API as low-ceremony as what it
replaced.

---

# References

- Module: [`lib/logger/README.md`](../../../next/src/lib/logger/README.md)
- Prior art this replaces: `lib/rate-limit/events.ts`, `modules/mcp/observability/events.ts`,
  `modules/notifications/observability/log.ts`
- Error architecture: `lib/errors/` (`AppError` and subclasses, `ErrorHandler`)
- Request-scoped context precedent: `lib/rate-limit/response-context.ts`
- Testing conventions: [`next/docs/testing/README.md`](../../../next/docs/testing/README.md),
  [`conventions.md`](../../../next/docs/testing/conventions.md)
