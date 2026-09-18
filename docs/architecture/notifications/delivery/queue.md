# The Queue

> **Status:** Implemented
>
> **Last Updated:** 2026-09-18
>
> **Ruling:** [ND-D-02](../../../project/feature-specification/notification/decisions/delivery.md#nd-d-02--the-queue-is-a-persisted-table-plus-a-sweep)

```text
Notification Decision -> Notification Generation -> Queue -> Delivery
```

The queue is the seam between deciding a notification should exist and getting
it to the user.

---

## What it is

A Postgres table, `notification_job`, and a sweep that drains it.

The earlier version of this document framed this as an open choice between a
persisted table and a purely conceptual seam with synchronous delivery, and
named the condition that would decide it:

> The moment a channel exists that can **fail independently** — email, push —
> Option 1 becomes necessary.

Web push is that channel. It fails for reasons the application does not control
and cannot fix synchronously: a device is offline, a provider is degraded, a
token died three weeks ago and nobody has been back since. So the queue is real.

There is still no broker. Postgres is already the durable source of truth,
already available in every execution, and already understood by everyone working
here. A broker would be infrastructure bought before its first requirement.

**The full working model is in [`../jobs/README.md`](../jobs/README.md).** This
document covers only what the queue means for delivery.

---

## What `delivered` means

The question the earlier version of this document said had to be answered first.

It has two answers, because it has two channels, and conflating them was the
trap:

| Channel | Delivered when | Why |
| --- | --- | --- |
| `IN_APP` | The row is committed | For an inbox, the record being visible *is* the delivery. There is no transport, no acknowledgement, and no later event to wait for |
| `WEB_PUSH` | Never claimed | The provider **accepting** a message is the strongest statement available. That is `SENT` |

This is what makes
[ND-H-03](../../../project/feature-specification/notification/decisions/history.md#nd-h-03--delivered-consumes-the-triple-undelivered-does-not)
coherent. `delivered = true` consumes the `(user, subject, intent)` triple and
means *the user is reasonably presumed to have been told*. An inbox entry they
can open satisfies that — whether or not a push ever succeeds, and whether or
not they own a device that could receive one.

Marking the in-app row delivered at generation time is therefore not the
shortcut this document once warned against. For that channel, generation and
delivery are genuinely the same moment. Push is separate, retried separately,
and never gates the inbox.

Full vocabulary:
[ND-D-03](../../../project/feature-specification/notification/decisions/delivery.md#nd-d-03--delivery-state-vocabulary).

---

## Idempotency

The concern this document raised was right, and it is handled at the database
rather than in application logic:

> - a partially completed sweep, re-run, must not duplicate notifications;
> - a delivery attempted twice must not count as two occurrences.

**The first is a uniqueness constraint.** `notification` is unique on
`(userId, intent, occurrenceKey)`, and a violation is treated as success — it
means the work already happened, which is what the caller wanted. A read-then-
write existence check would not hold: two concurrent executions both read "no
record" and both insert.

The occurrence key is computed by the *scheduler* and carried in the job's
payload, never recomputed by a worker
([ND-D-07](../../../project/feature-specification/notification/decisions/delivery.md#nd-d-07--occurrence-identity-is-decided-by-the-scheduler-never-by-the-worker)).
A worker deriving its own key would produce a different one the moment a retry
crossed UTC midnight, and the constraint would never see a collision.

**The second is bounded, not eliminated.** A worker that succeeds at the
provider and crashes before recording will send again. That is unsolvable across
a provider boundary without distributed transactions, so it is accepted openly
([ND-D-05](../../../project/feature-specification/notification/decisions/delivery.md#nd-d-05--at-least-once-never-exactly-once))
and mitigated at the client: every push carries a collapse identity equal to the
notification id, so the operating system replaces the earlier banner rather than
stacking a second one.

The *notification* is never duplicated. The *banner* might be, briefly, and the
user sees one either way.

---

## What the split bought

Concretely, and each of these is now a passing test rather than an intention:

- a push failure retries the push, and never re-runs recommendation generation;
- a push failure never removes or alters the inbox record;
- a dead token is deactivated on first proof and never retried;
- a user with three browsers gets one notification and three independent
  delivery records;
- a user who disables an intent after generation keeps the inbox entry and does
  not get the push;
- a worker that dies mid-delivery leaves work another worker picks up.

---

## What a second channel would cost

Email, when it arrives, is an adapter behind the existing `PushProvider`-shaped
boundary plus a `NotificationChannel` enum value. It does not touch generation,
the pipeline, any intent, or this queue.

That was the point of building the seam, and it is the property to check before
accepting any change here.
