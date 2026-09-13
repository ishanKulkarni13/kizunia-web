# The Queue

> **Status:** Design — blocking open decision (A-3)
>
> **Last Updated:** 2026-09-12

```text
Notification Decision -> Notification Generation -> Queue -> Delivery
```

The queue is the seam between deciding a notification should exist and getting it to the user.

---

## What it is for

The separation provides a foundation for:

- asynchronous delivery;
- retries;
- additional delivery channels;
- delivery status tracking;
- future notification clients.

> The exact queueing and delivery infrastructure remains intentionally open.

---

## What this repository actually has

Nothing.

> Kizunia has no background job/queue infrastructure — no Kafka, no RabbitMQ, no Temporal, no
> generic job framework, no worker fleet.

Every piece of scheduled or background work is a plain, synchronous application service invoked by
an ordinary authenticated HTTP request
([`workflows/internal-jobs.md`](../../workflows/internal-jobs.md)). The deployment target may be
Vercel's Hobby tier, which supports Vercel's own Cron Jobs but not arbitrary external schedulers.

So "queue" in this architecture is a **seam**, not a component. Writing this document as though a
broker existed would produce a design that cannot be built here.

---

## Blocking: what is the queue in Phase 1?

**Open item A-3.** Two coherent answers, neither chosen:

### Option 1 — A persisted table plus a sweep

Generated notifications are rows awaiting delivery. A scheduled sweep picks them up and delivers
them, following the existing cron convention
([`../triggers/scheduled-evaluation.md`](../triggers/scheduled-evaluation.md)).

| Gains | Costs |
| --- | --- |
| Real asynchrony; survives a failed delivery | A second scheduled job to operate |
| Retry becomes possible later without redesign | Delivery latency is bounded by sweep frequency |
| Delivery state is naturally observable | More moving parts for an in-app-only Phase 1 |

### Option 2 — A conceptual seam with synchronous delivery

Generation hands the notification to a delivery interface that happens to complete inline. The
boundary exists in the code; the asynchrony does not.

| Gains | Costs |
| --- | --- |
| Far less machinery for a Phase 1 that only writes to an inbox | Delivery failure is an evaluation failure |
| The seam still permits a real queue later | No retry story at all |
| Fits the repository's existing synchronous posture | Latency of delivery is inside the cron request |

### What makes this genuinely open

For in-app delivery, "delivering" largely means the record being visible in the inbox — at which
point Option 2 is close to sufficient and Option 1 is close to ceremony.

The moment a channel exists that can **fail independently** — email, push — Option 1 becomes
necessary. The decision is really about whether to pay for that now or at the point of need, and
whether the seam in Option 2 is genuinely sufficient to avoid a rewrite later.

That judgement needs the answer to one question that has not been asked: **what does `delivered`
mean for an in-app notification?**

---

## What `delivered` means

Deliberately left open
([`history/notification-record.md`](../../../project/feature-specification/notification/history/notification-record.md)),
but constrained: `delivered = true` consumes the `(user, competition, intent)` triple and prevents
that competition from being surfaced again for that intent
([ND-H-03](../../../project/feature-specification/notification/decisions/history.md#nd-h-03--delivered-consumes-the-triple-undelivered-does-not)).

So whatever "delivered" is defined as, it must mean **the user is reasonably presumed to have been
told**. Marking a record delivered at generation time would satisfy the type system and quietly
break the product rule.

---

## Idempotency

Whichever option is chosen, the queue is on a path that can re-run: Vercel may re-invoke a cron
request whose response indicated failure
([`../cross-cutting/failure-and-idempotency.md`](../cross-cutting/failure-and-idempotency.md)).

Two things must hold:

- a partially completed sweep, re-run, must not duplicate notifications;
- a delivery attempted twice must not count as two occurrences.

This is a design requirement for A-3, not a detail to settle afterwards.
