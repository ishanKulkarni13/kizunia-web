# Internal / Scheduled Job Invocation Convention

Status: Stable
Version: 1.0

## What this document establishes

Kizunia has no background job/queue infrastructure — no Kafka, no RabbitMQ,
no Temporal, no generic job framework, no worker fleet. Every piece of
"scheduled" or "background" work in this repository is a plain, synchronous
application service, invoked by an ordinary authenticated HTTP request:

```text
Scheduler
    ↓
Internal Job HTTP Endpoint   (the only place infrastructure exists)
    ↓
Domain / Application Service  (has no idea Vercel, cron, or HTTP exist)
    ↓
Repository / Database / Storage Provider
```

The endpoint is the entire boundary between "something invoked this" and
"the domain logic runs." A domain service (e.g.
`AssetReconciliationService`, `CompetitionLifecycleService`) never imports
anything Vercel-specific, never reads `process.env` for scheduling
concerns, and is exactly as callable from a future admin UI as it is from a
cron request — the invocation mechanism is not part of its contract.

## The standard convention (going forward)

A scheduled internal job endpoint:

- Is a `GET` route.
- Is authenticated via `Authorization: Bearer <CRON_SECRET>` — the header
  Vercel's own Cron Jobs feature sends automatically once a `CRON_SECRET`
  environment variable is configured for the project. See
  `next/src/lib/security/timing-safe-equal.ts` — the comparison must be
  constant-time, not a plain `!==`/`===`.
- Fails closed (401) if `CRON_SECRET` is unset or does not match.
- Is registered in `next/vercel.json`'s `crons` array, so Vercel's native
  scheduler — not an external one this repository has to configure or
  trust — is what actually invokes it. This matters concretely: Kizunia may
  deploy on Vercel's Hobby tier, which supports Vercel's own Cron Jobs but
  not arbitrary external schedulers calling into the app.
- Wraps its domain-service call in a try/catch and returns a real HTTP
  error status on failure (not an unhandled exception) — Vercel's own cron
  monitoring/retry behavior keys off the response status.
- Does not attempt any authorization beyond the shared secret. This is not
  part of Kizunia's session-based authorization model — there is no actor,
  no role, no `PlatformAuthorizer` check here. Session-based endpoints
  (e.g. an admin-triggered manual reconciliation run) are a completely
  separate route that happens to call the same domain service.
- Is safe to invoke more than once, on a retry, or concurrently with
  another invocation (including a session-authenticated manual trigger of
  the same service). This is a property of the domain service's own
  writes (compare-and-set, scoped by expected current status), not of the
  endpoint — the endpoint adds no locking of its own.

Every `CRON_SECRET`-protected route in this repository shares the **same**
`CRON_SECRET` value — Vercel does not support a distinct secret per cron
entry, only one per project. This is expected and matches Vercel's own
documented convention; it is not a case of two features accidentally
reusing each other's credentials.

## The tick: one cron entry, many tasks

The convention above is unchanged. What changed is **registration**.

Vercel's Hobby plan allows **two** cron entries, triggered daily, and this
project already used both. A third job could not get a slot — and exceeding
the limit fails the deploy rather than failing quietly.

So `vercel.json` now has one entry, `GET /api/v1/internal/tick`, which
dispatches a registry of tasks (`next/src/lib/internal-jobs/registry.ts`). Each
task declares a minimum interval and is guarded by a durable last-run marker
(`internal_job_run`), so a task that wants to run every three days still runs
every three days even when the tick fires daily — or every five minutes.

That marker is in the database rather than in memory for the obvious reason:
every invocation is a fresh process, and two concurrent ticks have to agree on
what has already run.

Three consequences worth stating:

- **Cadence becomes configuration.** The same endpoint is correct invoked daily,
  every five minutes, or by an external pinger. Nothing structural differs.
- **A failing task does not abort the tick.** These tasks are unrelated; letting
  the first failure stop the rest would turn one broken job into a stalled
  platform. Failures are recorded per task and reported in the response body.
- **Every task keeps its own route.** The dedicated endpoints below still work
  and are still the way to run one job by hand.

## Current state of every internal/scheduled endpoint

| Endpoint | Convention | Wired into `vercel.json`? |
|---|---|---|
| `GET /api/v1/internal/tick` | Standard (above), dispatching the task registry | **Yes — the only cron entry** |
| `GET /api/v1/internal/rate-limit/prune` | Standard (above) | No — runs as a registered task; route kept for manual runs |
| `GET /api/v1/internal/assets/reconcile` | Standard (above) | No — runs as a registered task; route kept for manual runs |
| `POST /api/v1/internal/competitions/lifecycle` | Older `x-internal-secret` / `INTERNAL_LIFECYCLE_SECRET` convention — predates this document | No — depends on an external scheduler this repository does not configure |

The Competition Lifecycle sweep has **not** been migrated to the standard
convention above. That is a deliberate scope boundary of the Asset-domain
work that introduced this document, not an oversight: migrating it touches
the Competition module, which was out of scope for that change. Migrating
it to the same `GET` + `CRON_SECRET` + `vercel.json` shape described here is
the natural next step, whenever someone picks up Competition Lifecycle
scheduling specifically.

## Cadence

The tick is scheduled `0 13 * * *` — daily, early afternoon UTC, which is when
the notification sweep wants to run (ND-I-23). Maintenance tasks keep their own
three-day interval through the registry rather than through the schedule.

On a plan with minute-level cron granularity, change that one schedule to
something like `*/5 * * * *` and nothing else: the notification task's own
interval guard keeps the daily evaluation daily, while delivery and retries get
a much tighter loop.

Historically, every entry used `0 0 */3 * *` (see the cron-semantics note in
`docs/architecture/domain/assets/lifecycle.md`'s reconciliation section) —
approximately every three days, anchored to the calendar rather than a
strict rolling interval. This is intentional, not a placeholder: these are
safety-net/reconciliation jobs, not the mechanism that keeps normal
operations correct (normal Asset/User-Asset operations reconcile
synchronously, in the same request that changes them — see
`docs/architecture/domain/assets/lifecycle.md`). A tighter cadence is not
adopted without a demonstrated operational need for one.
