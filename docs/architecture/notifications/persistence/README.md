# Persistence

> **Status:** Design — blocking open decisions attached
>
> **Last Updated:** 2026-09-12

What the subsystem stores, and the constraints the product rules place on how it is stored.

| Document | Contents |
| --- | --- |
| [notification-storage.md](notification-storage.md) | Notification occurrences, history immutability, deduplication reads |
| [preference-storage.md](preference-storage.md) | Competition preferences, notification preferences, and the legacy model question |

---

## Two things are stored

| Stored | Nature |
| --- | --- |
| **Notification records** | An append-only log of occurrences |
| **Preferences** | Current user state, read fresh at every evaluation |

Everything else the subsystem needs is **read from other domains** — competitions, bookmarks,
self-declared registrations — through a defined boundary
([`../module-boundaries.md`](../module-boundaries.md)). Notifications does not copy them.

---

## The constraints that shape storage

| Constraint | Ruling |
| --- | --- |
| History is append-only; a later notification is a **new** record | [ND-H-02](../../../project/feature-specification/notification/decisions/history.md#nd-h-02--history-is-retained-and-never-overwritten) |
| Deduplication reads `(user, competition, intent)` where `delivered = true` | [ND-H-03](../../../project/feature-specification/notification/decisions/history.md#nd-h-03--delivered-consumes-the-triple-undelivered-does-not) |
| Preferences are read **current**, never versioned for evaluation | [ND-H-05](../../../project/feature-specification/notification/decisions/history.md#nd-h-05--each-evaluation-uses-current-preferences) |
| Nothing may assume the subject is a competition | [`../principles.md`](../principles.md) |

---

## Open and blocking

Two items here block implementation:

- **A-2** — the disposition of the existing legacy `NotificationPreference` model
  ([preference-storage.md](preference-storage.md));
- **A-5** — the storage shape for an aggregated notification covering several competitions
  ([notification-storage.md](notification-storage.md)).

Plus **A-4**, whether relevance is stored at all, which is decided in
[`../recommendation/candidate-selection.md`](../recommendation/candidate-selection.md) but lands
here.

All are tracked in
[`open-decisions.md`](../../../project/feature-specification/notification/open-decisions.md).

---

## A note on scope

> The exact notification persistence model is intentionally left open.

This area records the **constraints** a persistence model must satisfy, not a schema. A schema
written before the blocking decisions are answered would be a guess, and a guessed-at schema is the
hardest kind of documentation to remove.
