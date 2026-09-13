# Failure and Idempotency

> **Status:** Design — largely open
>
> **Last Updated:** 2026-09-12

Unlike the other cross-cutting concerns, this one is not optional. **Re-runs are a certainty**, not
a future possibility.

---

## Why re-runs will happen

Vercel's cron monitoring and retry behavior key off the HTTP response status, and the repository's
convention is that a scheduled job wraps its domain call in try/catch and **returns a real error
status on failure**
([`workflows/internal-jobs.md`](../../workflows/internal-jobs.md)).

So a sweep that fails partway — after generating notifications for some users but not all — can be
invoked again.

A daily sweep over every eligible user also may not fit in one request
([`../triggers/scheduled-evaluation.md`](../triggers/scheduled-evaluation.md)), which pushes toward
batching, which produces partial completion by design rather than only by failure.

---

## The property required

**Re-running an evaluation must not produce duplicate notifications.**

For `TOP_RELEVANT_COMPETITION` there is a natural guard: a competition already **delivered** for
this `(user, intent)` is filtered out
([ND-H-03](../../../project/feature-specification/notification/decisions/history.md#nd-h-03--delivered-consumes-the-triple-undelivered-does-not)).

But that guard keys on **delivered**, not on generated. Between generation and delivery, a re-run
sees no delivered record and may generate a second one for the same competition — which is
consistent with the re-evaluation rule
([`history/re-evaluation.md`](../../../project/feature-specification/notification/history/re-evaluation.md))
and is almost certainly not what anyone wants twice within one day.

**This is unresolved.** It interacts with open item A-3, since what "delivered" means and how
quickly it is set determines how wide that window is
([`../delivery/queue.md`](../delivery/queue.md)).

---

## `REGISTRATION_CLOSING` has no natural guard at all

The deadline intent evaluates a **window**, and the window is open item A-1
([`../recommendation/candidate-selection.md`](../recommendation/candidate-selection.md)).

Every run overlapping that window sees the same competitions. Without a notion of *"this deadline
event has already been handled for this user"*, a window-based job re-notifies on every run.

So the window decision and the idempotency key are the same decision, and must be made together.
This is stated in
[`../triggers/scheduled-evaluation.md`](../triggers/scheduled-evaluation.md) and repeated here
because it is the single most likely source of a duplicate-notification bug in Phase 1.

---

## What is open

| Question | Related |
| --- | --- |
| Idempotency and retry behavior generally | Recorded as open in [`open-decisions.md`](../../../project/feature-specification/notification/open-decisions.md) |
| The idempotency key for a deadline event | A-1 |
| Whether generation alone should guard against same-run duplication | A-3 |
| Whether a partially completed sweep resumes or restarts | Batching design |
| What happens to an evaluation that fails mid-user | Not specified |

---

## What is decided

**There is no retry strategy in Phase 1.** An undelivered notification is not retried; a later
evaluation may produce a **new** record from current data, which is re-evaluation, not retry
([ND-H-04](../../../project/feature-specification/notification/decisions/history.md#nd-h-04--re-evaluation-creates-a-new-record-and-is-not-a-retry)).

The retry and re-delivery strategy remains an implementation concern that may evolve independently —
and belongs to the delivery layer, not to the pipeline.

---

## Failure posture

Two rules that should hold regardless of how the open questions resolve:

**One user's failure must not fail the sweep.** A per-user evaluation is an independent unit, which
is also why the processing context is scoped to one user and one intent
([`../pipeline/processing-context.md`](../pipeline/processing-context.md)).

**Failing to notify is better than notifying wrongly.** A missed notification is recoverable —
tomorrow's evaluation reconsiders the same competition, because an undelivered notification does
not consume its triple. A duplicate or incorrect notification is not recoverable; the user has
already read it.
