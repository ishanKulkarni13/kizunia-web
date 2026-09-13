# Delivery

> **Status:** Design — blocking open decision
>
> **Last Updated:** 2026-09-12

Delivery is everything after the subsystem has decided a notification should exist.

| Document | Contents |
| --- | --- |
| [generation-vs-delivery.md](generation-vs-delivery.md) | Why the split exists and what it buys |
| [queue.md](queue.md) | The seam — and what this repository actually has |
| [clients-and-channels.md](clients-and-channels.md) | Web-first, client-agnostic, future Expo/mobile |

---

## The shape

```text
Notification Decision
        ↓
Notification Generation
        ↓
Queue
        ↓
Delivery
```

This separation provides a foundation for:

- asynchronous delivery;
- retries;
- additional delivery channels;
- delivery status tracking;
- future notification clients.

> The exact queueing and delivery infrastructure remains intentionally open.

---

## The honest position

**This repository has no queue or job infrastructure** — no Kafka, no RabbitMQ, no Temporal, no
generic job framework, no worker fleet. Every piece of scheduled or background work is a plain
synchronous service invoked by an authenticated HTTP request
([`workflows/internal-jobs.md`](../../workflows/internal-jobs.md)).

So "queue" here is a **seam to design**, not a component to configure. Whether Phase 1's queue is a
persisted table plus a sweep, or a purely conceptual boundary with synchronous delivery behind it,
is **blocking open item A-3**
([`open-decisions.md`](../../../project/feature-specification/notification/open-decisions.md)).

Documenting it as though infrastructure exists would be the fastest way to produce an architecture
that cannot be built.

---

## Phase 1 delivery

In-app, web only. The notification appears in the user's inbox
([`experience/inbox.md`](../../../project/feature-specification/notification/experience/inbox.md)).

Two Phase 1 limitations are deliberate:

- **No pre-delivery validation.** Competition state is not re-checked before delivery; a cancelled
  competition's notification is still sent
  ([ND-I-17](../../../project/feature-specification/notification/decisions/intents.md#nd-i-17--competition-state-is-not-re-validated-before-delivery-in-phase-1)).
- **No retry strategy.** An undelivered notification is re-evaluated by a later run, producing a
  new record — which is not the same as retrying
  ([`history/re-evaluation.md`](../../../project/feature-specification/notification/history/re-evaluation.md)).

---

## What delivery must never do

| Must not | Why |
| --- | --- |
| Decide whether a notification should exist | That is the pipeline's job, and it happens before generation |
| Re-enter domain logic to re-derive candidates | Generation already settled it |
| Know which intent produced the notification | Intent is a generation-time concern; delivery handles notifications uniformly |
| Assume a web client | The model is client-agnostic ([ND-I-18](../../../project/feature-specification/notification/decisions/intents.md#nd-i-18--the-notification-model-is-client-agnostic)) |

The third row has one anticipated exception: a future per-intent channel preference would make
delivery aware of intent. That is a known extension, not licence to leak intent logic downward now.
