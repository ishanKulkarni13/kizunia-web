# `TOP_RELEVANT_COMPETITION`

> **Status:** Stable — Phase 1
>
> **Last Updated:** 2026-09-12
>
> **Rulings:** [ND-I-02](../decisions/intents.md#nd-i-02--top_relevant_competition-is-a-discovery-notification)
> through [ND-I-09](../decisions/intents.md#nd-i-09--becoming-registration-open-needs-no-separate-lifecycle-notification)

---

## Summary

| Element | Value |
| --- | --- |
| **Kind** | Discovery |
| **Purpose** | Introduce a competition that is highly relevant and currently actionable |
| **Trigger** | Scheduled discovery job, daily at midnight |
| **User eligibility** | Intent enabled, preference profile exists, required capability available |
| **Candidate rule** | Registration is currently open |
| **Exclusions** | Hard constraint failures; already **delivered** to this user for this intent |
| **Selection** | Exactly 1 competition |
| **Aggregation** | None |
| **Dedup scope** | `(user, competition, TOP_RELEVANT_COMPETITION)` |
| **User preference** | On / Off |

---

## Purpose

`TOP_RELEVANT_COMPETITION` introduces a competition to a user when Kizunia determines it is
sufficiently relevant to their configured competition preferences.

It is a **discovery** notification — not a recurring reminder about a competition the user has
already been shown. Discovery happens once per competition, per user.

---

## Registration must be open

A competition can only be considered while its registration is **currently open**.

Whether the competition itself has started is irrelevant. A competition may be `ONGOING` while
registration remains open; such a competition is still a valid candidate. The determining
condition is registration, not the event.

```text
Registration not yet open   ->  cannot be recommended
Registration open           ->  can be recommended
Registration closed         ->  cannot be recommended
```

**Why.** The notification exists to produce an action the user can actually take. A competition
they cannot enter is not an opportunity, however well it matches their interests.

Competition status is derived from lifecycle dates by the competition domain, not by this
subsystem — see
[`lifecycle-automation.md`](../../../../architecture/workflows/competition/lifecycle-automation.md).

---

## Daily discovery

The intent is evaluated through a scheduled discovery job, initially **once per day at midnight**.

The scheduled job is **only a trigger**. The underlying recommendation logic must remain
independent of the scheduler so it can later be invoked through other mechanisms — an admin action,
a domain event, a backfill — without duplicating business logic. See
[`scheduled-evaluation.md`](../../../../architecture/notifications/triggers/scheduled-evaluation.md).

### A daily evaluation is not a daily notification

The daily run does not mean every eligible user receives a notification every day. If there are no
sufficiently relevant new opportunities for a user, **no notification is generated** for them.

A notification must not be generated simply because the scheduled evaluation ran.

---

## Discovery history

A competition must not repeatedly generate the same discovery notification for the same user.
Discovery history is associated with:

```text
User + Competition + Notification Intent
```

Once a competition has been **delivered** to a user through `TOP_RELEVANT_COMPETITION`, it cannot
independently trigger another `TOP_RELEVANT_COMPETITION` notification for that user.

This remains true even if:

- the competition remains highly relevant;
- its relevance score changes;
- it remains registration-open;
- registration later closes and reopens.

### The delivery qualifier

A notification that was generated but **not delivered** does not consume the competition for this
intent. If the competition becomes the best candidate again in a later evaluation, a new
notification record may be generated. See
[`history/re-evaluation.md`](../history/re-evaluation.md) and
[ND-H-03](../decisions/history.md#nd-h-03--delivered-consumes-the-triple-undelivered-does-not).

### Previously recommended competitions still rank

The rule above governs **generating a new discovery notification**. It does not remove previously
recommended competitions from relevance ranking.

A competition that was previously surfaced may still appear in a user's current Top-N ranking if it
remains sufficiently relevant, and may still appear inside another intent's selection.

```text
Previous discovery prevents a repeated discovery notification.
Previous discovery does not make the competition irrelevant.
```

---

## Registration reopening

If registration closes and later reopens, the competition may become actionable again. Reopening
does **not** reset the user's discovery history.

| Situation | Outcome |
| --- | --- |
| User has never received this competition via this intent | May be considered when registration is open |
| User has already received it via this intent | Must not generate another discovery notification |

If reopening creates information genuinely worth communicating, that belongs to a lifecycle or
competition-update notification — neither of which exists in Phase 1 — rather than to a repeated
discovery notification.

---

## New actionable opportunities

A competition does **not** need to have been newly created on Kizunia to qualify as a new discovery
opportunity.

A competition may already exist in Kizunia while its registration is not yet open. When
registration becomes open, it becomes an actionable opportunity and can be considered.

> Recommendation freshness must not be defined solely by the competition's creation date.

This also means that a competition transitioning from `UPCOMING` to `REGISTRATION_OPEN` naturally
becomes eligible for the next evaluation, provided all other eligibility, preference, relevance,
threshold and history rules are satisfied. **No separate lifecycle-triggered notification is
required for that transition** in Phase 1
([ND-I-09](../decisions/intents.md#nd-i-09--becoming-registration-open-needs-no-separate-lifecycle-notification)).

---

## The full flow

```text
Eligible user
    │  intent enabled
    │  competition preference profile exists
    │  required capability available
    ▼
Candidate competitions
    │  registration currently open
    │  not previously delivered for this intent
    ▼
Apply hard constraints
    ▼
Calculate relevance
    ▼
Apply minimum threshold
    ▼
Rank
    ▼
Select according to the notification objective   ->  exactly 1
    ▼
Generate notification
    ▼
Queue
    ▼
Deliver
```

If no candidate survives, nothing is generated.

---

## Selection: exactly one

This intent surfaces **at most one competition** per evaluation. Its purpose is individual
discovery:

> "Here is a competition that is particularly relevant to you."

There is no user-configurable volume. A multi-competition summary is a **separate future intent**,
not a setting on this one — see
[`future/notification-intents.md`](../future/notification-intents.md) and the reconciliation at
[R-02](../decisions/reconciliations.md#r-02--top_relevant_competition-selection-count).

---

## User preference

On / Off. When disabled, the user is not eligible and the intent does not evaluate for them.

If a notification was generated and the user disables the intent before delivery, it is not sent
and is left `delivered = false`
([ND-P-14](../decisions/preferences.md#nd-p-14--disabling-an-intent-suppresses-already-generated-notifications)).

---

## Known gaps

- The relevance formula and the minimum threshold are undecided
  ([`open-decisions.md`](../open-decisions.md)).
- Whether "midnight" is a single global run or per-timezone is undecided.
- Whether relevance is recomputed for every eligible user every night, or incrementally, is an
  architecture and cost question — see
  [`candidate-selection.md`](../../../../architecture/notifications/recommendation/candidate-selection.md).
