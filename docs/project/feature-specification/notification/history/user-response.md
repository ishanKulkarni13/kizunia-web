# User Response

> **Status:** Stable
>
> **Last Updated:** 2026-09-12
>
> **Ruling:** [ND-H-08](../decisions/history.md#nd-h-08--response-is-binary)

For Phase 1, notification interaction is intentionally simple.

---

## The model

When the user **clicks or opens** a notification, it is considered responded to.

```text
Notification created
        │
responded = false
        │
User clicks notification
        │
responded = true
```

That is the entire interaction model. No more granular representation is required for Phase 1, and
the system does not distinguish between different kinds of notification interaction at this stage.

---

## Why one bit

Phase 1 needs to answer one question: **did this notification do anything?**

A single boolean answers it. Anything richer — distinguishing opened from clicked-through,
tracking which competition within an aggregated summary was clicked, recording dismissals — is
analytics, and analytics requirements are expected to change substantially.

Building the richer vocabulary now would mean guessing at it, and a guessed-at event taxonomy is
harder to remove than to add. The Phase 1 tracking surface is deliberately the minimum that is
certainly correct:

- the notification exists;
- whether it was delivered;
- whether the user responded.

---

## What `responded` does not do

**It does not affect deduplication.** Only `delivered` consumes a
`(user, competition, intent)` triple
([deduplication.md](deduplication.md)). A delivered notification the user ignored still counts as
told.

**It does not affect relevance.** Phase 1 relevance is computed from the user's declared
preference profile, not from their behavior. Behavioral signal is a future personalization input,
not a current one — see [`future/personalization.md`](../future/personalization.md).

**It does not affect unread state directly.** The inbox's unread indicator is a presentation
concern over the same underlying interaction; see [`experience/inbox.md`](../experience/inbox.md).
Phase 1 does not define a separate "read" state distinct from `responded`, and whether the two
should ever diverge is recorded in [`open-decisions.md`](../open-decisions.md).

---

## Future direction

The architecture must leave room for a richer tracking vocabulary without contaminating the core
notification business logic:

```text
generated · filtered · suppressed · delivered · opened · clicked
converted · registered · dismissed · ranking position
recommendation reason · algorithm version · experiment variant
```

**None of this is built in Phase 1.** The requirement is only that adding it later does not mean
rewriting the pipeline. See
[`analytics-and-tracking.md`](../../../../architecture/notifications/cross-cutting/analytics-and-tracking.md).
