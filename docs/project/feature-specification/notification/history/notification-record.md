# The Notification Record

> **Status:** Stable
>
> **Last Updated:** 2026-09-12
>
> **Rulings:** [ND-H-01](../decisions/history.md#nd-h-01--a-notification-record-is-an-occurrence),
> [ND-H-02](../decisions/history.md#nd-h-02--history-is-retained-and-never-overwritten)

A notification record represents an **actual notification occurrence** for a user.

That framing is the whole design. A record is not "this competition's notification status" and not
"this user's relationship with this competition". It is: *at this moment, for this reason, Kizunia
decided to tell this user about this thing.*

---

## What a record conceptually contains

| Element | Meaning |
| --- | --- |
| **User** | Who the notification is for |
| **Competition** | The subject of the notification |
| **Notification intent** | Why it was generated — which business purpose produced it |
| **Creation date/time** | When the decision was made |
| **Delivery state** | Whether it actually reached the user |
| **User response state** | Whether the user opened or clicked it |

This is the conceptual contract. The storage shape — tables, columns, how an aggregated
notification referencing several competitions is represented — is an architecture concern, covered
in
[`notification-storage.md`](../../../../architecture/notifications/persistence/notification-storage.md).

---

## History is retained

Notification history is retained because Kizunia provides a **notification inbox**, where past
notifications remain meaningful to the user. See [`experience/inbox.md`](../experience/inbox.md).

---

## Records are never overwritten

Historical notification records are **not** overwritten when a later notification for the same
competition is generated.

```text
Monday
  Competition A
  TOP_RELEVANT_COMPETITION
  delivered = false

Tuesday
  Competition A becomes eligible again
  Competition A
  TOP_RELEVANT_COMPETITION
  new notification record
```

The Monday record remains in history, exactly as it was.

> **A later notification is a new notification occurrence and creates a new record. It does not
> update or replace the previous notification record.**

**Why.** An inbox is a history. Mutating past entries would make it lie about what happened and
when — and would destroy the only record of a notification that failed to reach the user.

---

## The two states are independent

**Delivered** and **responded** answer different questions and move independently:

```text
created                     delivered = false, responded = false
delivered to the user       delivered = true,  responded = false
user clicks it              delivered = true,  responded = true
```

A notification can be created and never delivered — because the user disabled the intent in the
meantime
([ND-P-14](../decisions/preferences.md#nd-p-14--disabling-an-intent-suppresses-already-generated-notifications)),
or because delivery failed. A delivered notification may never be responded to; that is normal and
carries no consequence in Phase 1.

Only **delivered** affects future notifications. See [deduplication.md](deduplication.md).

---

## What `delivered` means exactly

The precise semantics of `delivered` and the underlying delivery mechanism are **implementation
concerns** and are intentionally left open for the implementation phase.

What is fixed is its role in the product rules: a delivered notification consumes its
`(user, competition, intent)` triple, and an undelivered one does not. Whatever definition of
"delivered" the implementation adopts must be consistent with that consequence.

See [`open-decisions.md`](../open-decisions.md) and
[`delivery/README.md`](../../../../architecture/notifications/delivery/README.md).

---

## One record, or one record per competition?

`REGISTRATION_CLOSING` aggregates several competitions into one user-facing notification
([`intents/registration-closing.md`](../intents/registration-closing.md)). The user sees one
message; the system needs to know which competitions it covered, so that each one's
`(user, competition, intent)` triple is accounted for.

How that is represented — one record with several subjects, or several records sharing a
presentation grouping — is an open storage decision, recorded in
[`open-decisions.md`](../open-decisions.md). The product requirements it must satisfy are:

- the user sees **one** notification
  ([ND-I-12](../decisions/intents.md#nd-i-12--one-notification-per-deadline-event));
- history accurately records which competitions were included;
- response state is meaningful at the level the user actually interacts with.
