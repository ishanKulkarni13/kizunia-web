# Scheduled Evaluation

> **Status:** Design — open decisions attached
>
> **Last Updated:** 2026-09-12

Both Phase 1 intents are scheduled.

| Intent | Schedule |
| --- | --- |
| `TOP_RELEVANT_COMPETITION` | Daily at midnight |
| `REGISTRATION_CLOSING` | Deadline evaluation — window **undecided** |

---

## The convention to follow

Kizunia has an established convention for scheduled work, documented in
[`workflows/internal-jobs.md`](../../workflows/internal-jobs.md). Notifications follows it rather
than inventing anything.

A scheduled internal job endpoint:

- is a `GET` route;
- is authenticated via `Authorization: Bearer <CRON_SECRET>` — the header Vercel's Cron Jobs
  feature sends automatically once `CRON_SECRET` is configured;
- compares the secret in **constant time**, using `next/src/lib/security/timing-safe-equal.ts`, not
  `!==`;
- fails closed with 401 if `CRON_SECRET` is unset or does not match;
- is registered in `next/vercel.json`'s `crons` array, so Vercel's native scheduler invokes it;
- wraps its domain-service call in try/catch and returns a real HTTP error status on failure, since
  Vercel's cron monitoring keys off the response status;
- attempts no authorization beyond the shared secret — this is outside Kizunia's session-based
  authorization model, and there is no actor.

The endpoint is the entire infrastructure boundary. Everything below it is ordinary domain code
that does not know cron exists.

---

## The shape

```text
Vercel Cron
    ↓
GET /api/internal/notifications/<intent>   Bearer CRON_SECRET
    ↓
Notification evaluation service             knows nothing about HTTP or Vercel
    ↓
The pipeline, per eligible user
```

Whether the two intents share one endpoint or have one each is an implementation choice. Sharing
couples their schedules; separating them means two `crons` entries. Neither affects the logic.

---

## Constraints this platform imposes

Verified, not assumed — and these shape the open decisions below.

| Constraint | Consequence |
| --- | --- |
| Vercel Cron granularity is coarse, and Hobby-tier deployments support only Vercel's own scheduler | A job cannot fire at an arbitrary instant per competition |
| A cron request is one HTTP request with a time limit | A sweep over all users and all candidates may not fit in one invocation |
| Vercel's retry behavior keys off the response status | A partially completed sweep that returns an error may be re-invoked |

That last row is the important one: **the evaluation must be safe to re-run**. See
[`../cross-cutting/failure-and-idempotency.md`](../cross-cutting/failure-and-idempotency.md).

---

## `TOP_RELEVANT_COMPETITION` — daily discovery

Initial schedule: once per day at midnight.

The daily evaluation does **not** mean every eligible user receives a notification every day. If
there are no sufficiently relevant new opportunities for a user, nothing is generated for them.

**Open:**

- whether "midnight" is one global run or per-user local midnight (A-6);
- whether the sweep processes all users in one invocation, or is batched across several (see the
  cost discussion in
  [`../recommendation/candidate-selection.md`](../recommendation/candidate-selection.md)).

---

## `REGISTRATION_CLOSING` — deadline evaluation

The intent targets exactly 24 hours before the actual registration deadline **timestamp**, not the
previous calendar day
([ND-I-10](../../../project/feature-specification/notification/decisions/intents.md#nd-i-10--registration_closing-targets-24-hours-before-the-deadline)).

A scheduled job cannot fire at an arbitrary instant per competition, so the schedule approximates
the target through a **window**.

**This is blocking** — open item A-1. Whatever is chosen must answer:

- which competitions are in scope for a given run — for example, "deadline falls within the next 24
  to 48 hours";
- how often the job runs, which determines how close to T-24h the notification lands;
- how a deadline event is identified, so that **exactly one** notification per user per deadline
  event is produced no matter how many runs see it.

The third point is the one that cannot be skipped. Without a notion of "this deadline event has
already been handled for this user", a window-based job will re-notify on every run that overlaps
the window.

---

## Testability

Because the endpoint is only a boundary, the evaluation service is directly invokable from a test
with no HTTP, no cron and no Vercel — which is the property that makes the scheduled behavior
testable at all
([`../testing/test-surface.md`](../testing/test-surface.md)).

The evaluation timestamp is context rather than ambient clock reads
([`../pipeline/processing-context.md`](../pipeline/processing-context.md)), so a test can evaluate
"as of" any moment without manipulating system time.
