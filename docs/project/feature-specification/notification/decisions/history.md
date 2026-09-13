# Decisions — History, Deduplication and Response

> **Status:** Live
>
> **Last Updated:** 2026-09-12

Rulings covering notification records, what suppresses future notifications, and how user response
is tracked. Explanatory treatment lives in [`history/`](../history/README.md).

---

## ND-H-01 — A notification record is an occurrence

**Status:** Accepted

A notification record represents an **actual notification occurrence** for a user. Conceptually it
carries:

- user
- competition
- notification intent
- creation date/time
- delivery state
- user response state

**Rationale:** Modelling "has this competition been notified about?" as a flag on the competition
or the relationship would lose the timeline, which the inbox needs. An occurrence log answers both
"what did we send?" and "what should we suppress?".

---

## ND-H-02 — History is retained and never overwritten

**Status:** Accepted

Notification history is retained because Kizunia provides a notification inbox where past
notifications remain meaningful to the user.

Historical records are **not** overwritten when a later notification for the same competition is
generated.

```text
Monday    Competition A   TOP_RELEVANT_COMPETITION   delivered = false
Tuesday   Competition A   TOP_RELEVANT_COMPETITION   new record
```

The Monday record remains.

> A later notification is a new notification occurrence and creates a new record. It does not
> update or replace the previous notification record.

**Rationale:** An inbox is a history. Mutating past entries would make it lie.

---

## ND-H-03 — Delivered consumes the triple; undelivered does not

**Status:** Accepted

Notification history affects future candidate eligibility according to the intent. For the Phase 1
discovery intent:

```text
Previous notification exists
├── delivered = true    -> exclude this competition for the same intent
└── delivered = false   -> competition remains eligible for future evaluation
```

An undelivered notification does not permanently consume the competition for that intent.

**Rationale:** Suppression exists to avoid telling a user the same thing twice. A notification the
user never received has not told them anything.

**Reconciliation:** an earlier passage in the source material read as "once surfaced, never
again", without the delivery qualifier. This ruling is the refined and authoritative form — see
[reconciliations.md](reconciliations.md#r-01--deduplication-is-keyed-on-delivery-not-on-generation).

---

## ND-H-04 — Re-evaluation creates a new record and is not a retry

**Status:** Accepted

If a competition with an undelivered notification becomes the best candidate again in a later
evaluation, Kizunia may generate a **new** notification record. This is re-evaluation, not a
direct delivery retry.

The retry / re-delivery strategy is a separate implementation concern and may evolve
independently.

**Rationale:** The later evaluation re-derived the recommendation from current data and current
preferences. That is a new decision, and it deserves its own record. Reusing the old record would
misdate it and conflate two distinct mechanisms.

---

## ND-H-05 — Each evaluation uses current preferences

**Status:** Accepted

Every scheduled evaluation uses the user's **current** competition preference profile. Past
preference configurations do not affect the current evaluation.

```text
Monday    preferences: AI 0.9
Tuesday   user changes to: Design 0.9
Tuesday's evaluation uses Design 0.9
```

Historical notification records remain preserved independently.

**Rationale:** Relevance is a statement about what the user cares about *now*. Versioning
preferences and replaying history against past configurations would add significant complexity for
no user-visible benefit.

---

## ND-H-06 — Deduplication is keyed on user + competition + intent

**Status:** Accepted

Notification identity is conceptually:

```text
(user, competition, notification intent)
```

and **not**:

```text
(user, competition)
```

A previous discovery notification does not prevent a later deadline notification for the same
competition.

**Rationale:** The competition is the subject, not the reason. "We found Competition A" and
"Competition A's registration closes tomorrow" are different messages serving different purposes.

---

## ND-H-07 — Different intents are independent

**Status:** Accepted

The same competition may generate notifications for different intents, including on the same day
when each intent's conditions are satisfied:

```text
10:00   Competition A   TOP_RELEVANT_COMPETITION
14:00   Competition A   REGISTRATION_CLOSING
```

This is intentional and acceptable.

> A notification for one reason does not suppress a notification for another reason.

**Rationale:** Each intent owns its own rules. Cross-intent suppression would couple intents
together and break the extensibility boundary that makes new intents cheap to add.

**Note:** cross-intent volume limits are a legitimate future capability, but they are a *limit*,
not a *dedup rule*, and are not in Phase 1 — see [`future/README.md`](../future/README.md).

---

## ND-H-08 — Response is binary

**Status:** Accepted

For Phase 1, notification interaction is intentionally simple. Clicking or opening a notification
marks it responded.

```text
Notification created  -> responded = false
User clicks           -> responded = true
```

No more granular interaction model is required, and the system does not distinguish kinds of
interaction at this stage.

**Rationale:** One bit answers the only Phase 1 question — did this notification do anything? A
richer event vocabulary is a future analytics concern and is listed in
[`future/personalization.md`](../future/personalization.md).

---

## ND-H-09 — Previously notified competitions may still rank

**Status:** Accepted

ND-H-03 prevents a delivered competition from generating another notification for the same intent.
It does **not** remove that competition from relevance ranking.

A previously surfaced competition may still appear in a user's current ranking if it remains
sufficiently relevant, and may still appear inside another intent's aggregated selection.

```text
Previous discovery prevents a repeated discovery notification.
Previous discovery does not make the competition irrelevant.
```

**Rationale:** Relevance and notification eligibility are different questions. Deleting past
recommendations from the ranking would corrupt the ranking itself and would leak discovery history
into every other intent that consumes relevance.
