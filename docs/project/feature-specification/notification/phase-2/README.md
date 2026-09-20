# Phase 2 — Delivery

> **Status:** Live
>
> **Last Updated:** 2026-09-17

Phase 1 specified the decision: *should this user be told about this?* It stopped there, on
purpose, and the implementation stopped with it — a policy layer with no trigger, no record, and
nothing behind it.

Phase 2 is everything between that decision and the user actually being told.

---

## What changes

| | Phase 1 | Phase 2 |
| --- | --- | --- |
| Decision | Specified and implemented | Unchanged. Still the source of truth |
| Record | Specified, not built | Built — durable, append-only, with subjects |
| Inbox | Specified, not built | Built |
| Queue | Deliberately undecided | A persisted table plus a sweep |
| Delivery | Out of scope | In-app and web push, with per-destination state |
| Retry | "No retry strategy in Phase 1" | Bounded, classified, backed off |
| Intents | `TOP_RELEVANT_COMPETITION` only, in code | Both competition intents, plus announcements |

---

## Documents

| Document | Contents |
| --- | --- |
| [`scope.md`](scope.md) | What Phase 2 includes, and what it must be true for it to ship |
| [`boundaries.md`](boundaries.md) | What it still excludes, and why |

The rulings this phase produced live in the decision register as usual — principally
[`decisions/delivery.md`](../decisions/delivery.md) (new), plus additions to
[`intents.md`](../decisions/intents.md), [`history.md`](../decisions/history.md) and
[`preferences.md`](../decisions/preferences.md).

Implementation state is tracked separately, in
[`architecture/notifications/IMPLEMENTATION-STATUS.md`](../../../../architecture/notifications/IMPLEMENTATION-STATUS.md).

---

## On the Phase 1 boundary

[`phase-1/boundaries.md`](../phase-1/boundaries.md) forbade an unspecified intent appearing "in the
code, in the database enum, or in the user interface — even as a placeholder — until it has its own
specification and its own ruling."

That rule was never a permanent ban on the items it listed. It was a requirement that they arrive
with a specification attached. `REGISTRATION_CLOSING`, `FEATURE_ANNOUNCEMENT` and the web push
channel now have one, and rulings to go with it, which is precisely the condition the boundary set.

Phase 1's documents are not rewritten to pretend otherwise. They describe what Phase 1 decided, and
where a later ruling amends one, the amendment is recorded on the ruling itself.
