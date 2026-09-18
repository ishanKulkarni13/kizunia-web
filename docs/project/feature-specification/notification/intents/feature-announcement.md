# `FEATURE_ANNOUNCEMENT`

> **Status:** Stable — Phase 2
>
> **Last Updated:** 2026-09-17
>
> **Rulings:** [ND-I-21](../decisions/intents.md#nd-i-21--feature_announcement-is-an-admin-authored-scheduled-broadcast),
> [ND-I-22](../decisions/intents.md#nd-i-22--an-announcement-is-scheduled-and-scheduling-is-the-general-case),
> [ND-P-16](../decisions/preferences.md#nd-p-16--per-intent-defaults-not-one-global-default)

---

## Summary

| Element | Value |
| --- | --- |
| **Kind** | Platform / editorial |
| **Purpose** | Tell users about something new on Kizunia |
| **Trigger** | Admin authorship, then a scheduled delivery time |
| **Timing** | The author's chosen time |
| **User eligibility** | Intent enabled |
| **Candidate rule** | None — the announcement is the subject |
| **Exclusions** | None |
| **Selection** | None |
| **Aggregation** | None. One announcement is one notification |
| **Dedup scope** | One notification per user per announcement |
| **User preference** | On / Off, defaulting **on** |

---

## Purpose

The first intent whose subject is not a competition.

That matters more than the feature does. Every other notification in the system is the output of an
algorithm reasoning about competitions; this one is a person deciding something is worth saying.
Principle 1 asked that the first non-competition intent require no structural change, and this is
the test of it.

---

## Content

An announcement carries a title, a message, and optionally a link.

| Field | Required | Notes |
| --- | --- | --- |
| Title | Yes | Short. Becomes the notification title verbatim |
| Message | Yes | Becomes the notification body verbatim |
| Link | No | Where the notification leads. An announcement with nothing to link to is legitimate |

The link is the one place in the system where notification content is authored by a human rather
than rendered from structured facts, which makes it the one place an unsafe destination could
enter. It is validated on the way in: an `https` address, or a path within Kizunia. Nothing else.

There is no template system, no formatting language, and no variable substitution. Announcements
are infrequent and short, and a template engine is explicitly out of scope.

---

## Recipients

Every user with the intent enabled. There is no segmentation, no targeting, and no audience model.

This is a deliberate floor, not a first increment. Segmentation is the feature that turns a
notification system into a marketing platform, and the boundaries document excludes that
explicitly. It can be added later as a recipient rule; it is very hard to remove later once other
things depend on it.

Because announcements default **on** ([ND-P-16](../decisions/preferences.md#nd-p-16--per-intent-defaults-not-one-global-default)),
"every user with the intent enabled" means, in practice, every user who has not turned it off.

---

## Timing

Delivery time is a property of the announcement, chosen by its author.

```text
draft  ->  scheduled  ->  publishing  ->  published
```

"Send it now" is a schedule time of now. There is no separate immediate path — the one an author
uses least often is not worth being the only one that is well tested.

An announcement may be cancelled before it starts publishing. Once fan-out has begun, cancellation
stops further fan-out but does not retract notifications already created: they are history, and
history is not rewritten
([ND-H-02](../decisions/history.md#nd-h-02--history-is-retained-and-never-overwritten)).

---

## The full flow

```text
Authorized admin
    │  title, message, optional link, delivery time
    ▼
Announcement stored, scheduled
    ▼
Delivery time arrives
    ▼
Fan-out over users with the intent enabled
    │  in bounded pages, recording progress
    ▼
One notification per user
    ▼
Inbox  +  push delivery
    ▼
Delivery tracking
```

Fan-out is **resumable**. It proceeds in pages and records where it got to, so an interrupted run
continues rather than restarting — which at any real user count is the difference between "the
announcement went out" and "some people got it twice".

---

## Deduplication

One notification per user per announcement. Re-running fan-out, in whole or in part, produces no
duplicates: the occurrence identity is the announcement itself.

This is the simplest possible case of the general rule
([ND-D-06](../decisions/delivery.md#nd-d-06--idempotency-is-enforced-by-the-database-not-by-a-check)),
which is a useful property for the intent that is most likely to be re-run by a nervous operator
watching a fan-out.

---

## Authorization

Creating, scheduling and cancelling an announcement requires an explicit platform permission, held
by administrators. It uses Kizunia's existing authorization model — the same permission set,
policy and assertion path as every other administrative capability — and introduces nothing of its
own.

---

## Known gaps

- **No targeting.** Deliberate; see above.
- **No preview or test send.** An author cannot send an announcement to themselves first. Worth
  having; not built.
- **No edit-after-scheduling story beyond cancel-and-recreate.**
- **Cancellation mid-fan-out is partial by nature.** Users already fanned out keep their
  notification. This is correct, but it is worth knowing before cancelling.
