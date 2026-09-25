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
  trust — is what invokes it by default. This matters concretely: Kizunia may
  deploy on Vercel's Hobby tier, whose own Cron Jobs are limited to daily
  granularity. (An external scheduler calling the same endpoint with the same
  secret is also supported when a tighter cadence is needed — see Cadence below.)
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

**Task order and time budgets (decided 2026-09-24,
[IB-10](../subscription/implementation/open-decisions.md#ib-10--tick-time-budget);
values chosen in Subscription & Billing Phase IV, 2026-09-25).** The tick route
has `maxDuration = 60` and runs its tasks one after another, in the order of
`next/src/app/api/v1/internal/tick/tasks.ts` (a unit test pins it):

| Order | Task | Minimum interval | Budget |
|---|---|---|---|
| 1 | `billing:sync` | 60 s (every tick) | 10 s soft (`BILLING_SYNC_WALL_CLOCK_MS`): no new provider fetch starts after it, so the worst case is 10 s plus one provider timeout (10 s) |
| 2 | `notifications:tick` | the notification sweep interval (≤ 300 s) | 30 s (`NOTIFICATION_WORKER_BUDGET_MS`, lowered from 45 s) |
| 3 | `rate-limit:prune` | 3 days | short, database only |
| 4 | `assets:reconcile` | 3 days | short |
| 5 | `billing:orphan-discovery` (Phase V) | 900 s (`BILLING_ORPHAN_MIN_INTERVAL_SECONDS`) | 5 s soft (`BILLING_ORPHAN_WALL_CLOCK_MS`), at most 3 list pages; takes whatever the tasks before it leave |

Worst case for tasks 1–4: 20 s + 30 s, plus the two three-day tasks and
teardown, under 60 s. The budget has not yet been measured under realistic
notification load; do so before LIVE. `billing:orphan-discovery` runs **last**
(IB-25 item 6): the arithmetic above leaves no room for another
provider-calling task before notifications, and the scan is read-only and saves
its cursor after every page, so a run that `maxDuration` cuts short loses
nothing and the next run resumes. `billing:payload-prune` (Phase VIII) will
also run at low frequency. Reaching the billing target cadence (about 5 minutes) on the
Hobby plan needs the external pinger described above; the choice is a
LIVE-readiness item
([IB-19](../subscription/implementation/open-decisions.md#ib-19--tick-cadence-on-the-vercel-hobby-plan)).

## Current state of every internal/scheduled endpoint

| Endpoint | Convention | Wired into `vercel.json`? |
|---|---|---|
| `GET /api/v1/internal/tick` | Standard (above), dispatching the task registry | **Yes — the only cron entry** |
| `GET /api/v1/internal/rate-limit/prune` | Standard (above) | No — runs as a registered task; route kept for manual runs |
| `GET /api/v1/internal/assets/reconcile` | Standard (above) | No — runs as a registered task; route kept for manual runs |
| `GET /api/v1/internal/billing/sync` | Standard (above) | No — runs as the `billing:sync` task; route kept for manual runs (and for TEST, where the daily cron is a slow backstop) |
| `GET /api/v1/internal/billing/orphan-discovery` | Standard (above) | No — runs as the `billing:orphan-discovery` task; route kept for manual runs (and for TEST) |
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

On Vercel Hobby, the same tighter cadence is available without changing plans:
an **external scheduler** (any HTTPS cron service) may call
`GET /api/v1/internal/tick` with `Authorization: Bearer <CRON_SECRET>`. The route
is public by necessity and authenticated only by that secret, so nothing
distinguishes the external caller from Vercel's own cron — and nothing needs to.
Moving later from an external scheduler to Vercel Cron is a deployment-configuration
change only. Subscription & Billing relies on this: its background work is
scheduler-agnostic, targets a 5-minute cadence, and stays correct (with documented
latency) on the daily trigger alone — see
[SB-PB-06](../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-06--billing-execution-is-scheduler-agnostic).

Historically, every entry used `0 0 */3 * *` (see the cron-semantics note in
`docs/architecture/domain/assets/lifecycle.md`'s reconciliation section) —
approximately every three days, anchored to the calendar rather than a
strict rolling interval. This is intentional, not a placeholder: these are
safety-net/reconciliation jobs, not the mechanism that keeps normal
operations correct (normal Asset/User-Asset operations reconcile
synchronously, in the same request that changes them — see
`docs/architecture/domain/assets/lifecycle.md`). A tighter cadence is not
adopted without a demonstrated operational need for one.
