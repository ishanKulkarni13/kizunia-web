# Work and Execution

> **Status:** Implemented
>
> **Last Updated:** 2026-09-18

How asynchronous notification work is represented, scheduled, claimed, retried
and recovered.

The product rules live in
[`decisions/delivery.md`](../../../project/feature-specification/notification/decisions/delivery.md).
This describes the machine.

---

## The shape

```text
                    ┌──────────────────────────────────────┐
 trigger  ────────▶ │  GET /api/v1/internal/tick           │
 (cron, pinger,     │  schedule → drain → prune            │
  manual run)       └──────────────┬───────────────────────┘
                                   │
                ┌──────────────────┴──────────────────┐
                ▼                                     ▼
      ┌───────────────────┐              ┌────────────────────────┐
      │ Scheduler         │              │ Job runner             │
      │ one job per user; │              │ claim a bounded batch  │
      │ FREEZES occasion  │              │ under a lease;         │
      │ and window        │              │ dispatch by kind       │
      └─────────┬─────────┘              └───────────┬────────────┘
                │                                    │
                └────────▶  notification_job  ◀──────┘
                           Postgres, SKIP LOCKED
```

---

## The unit of work is one user

Not one sweep, and not one competition.

A sweep that evaluated every user inside one execution would be a single
unbounded unit: unresumable, unretryable per user, and fatal to everyone if it
failed for anyone. One job per user makes each user independent — able to fail,
retry and recover alone — and makes the whole sweep resumable by construction.

At 2,000 users that is 2,000 rows a day per intent. Cheap to insert in bulk,
cheap to claim in batches, pruned once finished.

It is also what dissolved the cost problem behind the deadline intent. Asking
"who cares about this competition?" means recomputing relevance per user;
asking "what does this user care about?" is one engine run they were going to
need anyway ([ND-I-20](../../../project/feature-specification/notification/decisions/intents.md#nd-i-20--deadline-relevance-is-recomputed-per-user-not-stored)).

---

## Claiming

One statement. A CTE selects due rows `FOR UPDATE SKIP LOCKED`; the enclosing
`UPDATE` marks them claimed and takes a lease.

`SKIP LOCKED` is what makes concurrent executions safe. A second worker running
the same statement at the same instant passes over the rows the first is taking,
rather than blocking behind them or — far worse — taking them too.

Three details are load-bearing and easy to get wrong:

**An attempt is consumed at claim time, not at completion.** If attempts were
charged on completion, a worker that crashed mid-job would never burn one, and
the job would be re-claimed forever after every lease expiry.

**`runAt` is pushed to the lease expiry on claim.** "Due" then means exactly one
thing — `runAt <= now` — so a pending job is due at its scheduled time and a
claimed job becomes due again the moment its lease lapses. One predicate, one
index, and no separate recovery sweep to forget to run.

**The claim predicate excludes exhausted jobs**, and a reaper retires any whose
lease lapsed with nothing left to try. Without the reaper those rows are
invisible to `claim` but still read as `PROCESSING` — alive in the table, dead
in practice, and misleading to whoever looks.

### Crash recovery is the lease, and nothing else

There is no dead-letter dance and no operator step. A worker that vanishes
mid-job holds a lease that expires; the next claim takes the job. That is the
whole mechanism, which is why it cannot be forgotten or misconfigured.

---

## Timing

Every timing class reduces to one column: `runAt`.

| Class | `runAt` |
| --- | --- |
| Instant | now — bounded by sweep cadence |
| Near real time | now — same |
| Scheduled | the next configured hour |
| Relative | deadline − offset |
| Admin | the announcement's own scheduled time |

There is deliberately no separate infrastructure per class. Changing a class
later is a change to one computation.

---

## Time is frozen by the scheduler

The subtlest correctness requirement here, and invisible from the code that
gets it wrong.

The occurrence key and any evaluation window are computed **once**, when work is
scheduled, and carried in the payload. A worker reads them; it never derives
them from its own clock
([ND-D-07](../../../project/feature-specification/notification/decisions/delivery.md#nd-d-07--occurrence-identity-is-decided-by-the-scheduler-never-by-the-worker)).

Without this, a job retried across a UTC midnight computes a *different*
occurrence key and generates a second notification for the same occasion, while
a deadline window recomputed a day later silently evaluates a different set of
competitions under the same key.

This is the same rule the policy layer already followed — `evaluatedAt` is
always caller-supplied — extended across the process boundary that retries
introduce.

---

## Execution on Vercel

One cron entry, pointing at one tick endpoint, dispatching a registry of tasks.

The convention in
[`workflows/internal-jobs.md`](../../workflows/internal-jobs.md) is unchanged and
still followed: `GET`, `Authorization: Bearer <CRON_SECRET>`, constant-time
comparison, fail closed, try/catch around the domain call. Every task remains
individually invocable at its own route.

What changed is registration, and only because it had to: Vercel's Hobby plan
allows **two** cron entries at daily granularity, and this project already used
both. A third job could not get a slot, and adding one fails the deploy rather
than failing quietly. So the cron entry points at `/api/v1/internal/tick`, and a
registry decides what actually runs — each task declaring its own minimum
interval, guarded by a durable last-run marker.

The result is that **cadence is configuration**. The same endpoint is correct
invoked daily on Hobby, every five minutes on Pro, or by an external pinger.
Nothing structural differs between them.

### The tick's order matters

Schedule, then drain, then prune.

The scheduler enqueues evaluation jobs; the drain runs them; running one
enqueues a delivery job, which the *same* drain picks up because it loops until
a claim comes back empty. So one tick can carry a notification from "it is this
user's turn" all the way to a push.

Draining first would leave everything scheduled this tick waiting for the next
one — a day, on a daily trigger.

For the same reason the drain loop stops on an **empty** claim rather than a
short one. Treating a short batch as an empty queue saves one cheap query and
quietly defers every piece of work a handler enqueues.

### The budget

A drain pass stops claiming when there is not enough time left to finish another
batch safely, and reports that work remains. It does not try to finish the
queue.

Being killed mid-job by a platform timeout is survivable — the lease expires and
the job is re-claimed — but it wastes an attempt and delays the work. Stopping
cleanly is strictly better.

---

## Retry

Bounded, classified, and backed off with jitter. Numbers and their reasoning are
in `src/modules/notifications/config/notification-config.ts`.

An unrecognised failure is treated as **retryable**. The two ways to be wrong
are not symmetric: a permanent error retried wastes a few bounded attempts,
while a transient one treated as permanent silently drops a notification.

Jitter is not optional at this scale. One scheduler pass enqueues one job per
user; if a shared dependency fails, all of them fail at once and — without
jitter — retry at the same instant, reproducing the overload that caused the
failure.

---

## The Kafka seam

`WorkQueue` is an interface. `PostgresWorkQueue` is its only implementation.

Nothing above that interface knows the work lives in Postgres, is claimed with
`SKIP LOCKED`, or is protected by a lease. Replacing it with a broker is a
change to one file.

That is the entire preparation for Kafka, and deliberately all of it. No
Kafka-shaped concepts have been added to the domain, no local development
depends on a broker, and nothing has been abstracted on the theory that it might
help later ([principle 13](../principles.md)).

---

## Where the code is

```text
src/modules/notifications/
├── jobs/
│   ├── work-queue.port.ts        the interface, no Prisma
│   ├── postgres-work-queue.ts    the only raw SQL in the module
│   ├── job-payload.ts            a zod contract per kind
│   ├── backoff.ts                pure, injected RNG
│   ├── job-error.ts              retryable vs permanent
│   ├── job-runner.ts             the budgeted drain loop
│   └── handlers/                 one per kind, plus the registry
├── scheduling/occurrence.ts      pure: keys, windows, next run
└── backend/
    ├── notification-scheduler.service.ts
    └── notification-tick.service.ts

src/lib/internal-jobs/registry.ts  the shared task registry
src/app/api/v1/internal/tick/      the one cron route
```

---

## Raw SQL hazards

Confined to `postgres-work-queue.ts`, which is why it is the only file allowed
raw SQL. Each of these is silent when wrong:

**Timestamps must be bound explicitly as UTC.** Prisma's `DateTime` columns are
`timestamp` — no time zone, holding the UTC wall clock — but the driver binds a
JS `Date` as `timestamptz`. Comparing them makes Postgres convert the column
using the **session** time zone. Observed on a server set to `Asia/Calcutta`:
jobs claimed five and a half hours before they were due, with no error anywhere.
It would pass unnoticed on a UTC server and break on any other.

**Enum literals are cast, never parameterised.** Prisma binds string parameters
as `text`, and comparing an enum column to `text` raises
`operator does not exist`.

**`updatedAt` is written explicitly.** `@updatedAt` is applied by the client;
raw SQL bypasses it and the non-null column keeps a stale value.

**`$queryRaw`, not `$executeRaw`** — the latter discards `RETURNING`.
