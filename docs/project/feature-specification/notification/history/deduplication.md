# Deduplication

> **Status:** Stable
>
> **Last Updated:** 2026-09-12
>
> **Rulings:** [ND-H-03](../decisions/history.md#nd-h-03--delivered-consumes-the-triple-undelivered-does-not),
> [ND-H-06](../decisions/history.md#nd-h-06--deduplication-is-keyed-on-user--competition--intent),
> [ND-H-07](../decisions/history.md#nd-h-07--different-intents-are-independent),
> [ND-H-09](../decisions/history.md#nd-h-09--previously-notified-competitions-may-still-rank)

A competition should not repeatedly generate the **same notification reason** for the same user.

```text
Competition A discovered
        │
"Competition A may interest you"
        │
Notification delivered

        ... later ...

Competition A discovered again
        │
Already notified for this reason
        │
Do not notify again
```

---

## The key is the triple

Notification identity is conceptually:

```text
(user, competition, notification intent)
```

and **not**:

```text
(user, competition)
```

Deduplication is based on the notification **reason**, not simply on the competition.

---

## Different reasons produce different notifications

The same competition can legitimately generate different notifications over time:

```text
Competition A
│
├── Relevant competition discovered
│      -> notify once
│
└── Registration deadline approaching
       -> separate notification
```

A previous discovery notification does not prevent a later deadline notification.

> "We found Competition A"

may already have been sent, while

> "Competition A's registration deadline is approaching"

can still be sent when its own rules are satisfied.

This holds even on the same day:

```text
10:00 AM   Competition A   Top recommendation
2:00 PM    Competition A   Registration closing tomorrow
```

Both are valid. **A notification for one reason does not suppress a notification for another
reason.**

### Why intents do not suppress each other

Each intent owns its own rules. Cross-intent suppression would couple intents together — adding a
third intent would mean revisiting the dedup logic of the first two — which breaks the
extensibility boundary that makes new intents cheap to add.

Limiting a user's **total** notification volume is a legitimate future capability, but that is a
*limit*, not a *dedup rule*. It is not in Phase 1 — see [`future/README.md`](../future/README.md).

---

## Delivery is what consumes the triple

Notification history affects future candidate eligibility according to the intent. For the Phase 1
discovery intent:

```text
Previous notification exists
        │
        ├── delivered = true
        │       │
        │   Exclude competition for the same notification reason
        │
        └── delivered = false
                │
            Competition remains eligible for future evaluation
```

An undelivered notification does **not** permanently consume the competition for that reason.

**Why.** Suppression exists so a user is not told the same thing twice. A notification the user
never received has not told them anything. Treating generation alone as consumption would silently
deny a user a recommendation they never saw — which is the exact failure the deduplication rule
exists to prevent the *opposite* of.

If the competition becomes the best candidate again in a later evaluation, a new notification
record is generated. That is **re-evaluation**, not a delivery retry — see
[re-evaluation.md](re-evaluation.md).

---

## Deduplication is not down-ranking

Excluded and low-scoring are different things.

A competition already delivered for an intent is removed at the **candidate-filtering** stage for
that intent — before scoring
([`relevance/candidate-filtering.md`](../relevance/candidate-filtering.md)). It is not penalized
inside the relevance score.

Consequently:

```text
Previous discovery prevents a repeated discovery notification.
Previous discovery does not make the competition irrelevant.
```

A previously surfaced competition may still appear in a user's current ranking and may still be
selected by a **different** intent. Baking history into the score would corrupt the ranking and
leak one intent's history into every other intent that consumes relevance.

---

## Within-run deduplication

`REGISTRATION_CLOSING` has a second, narrower dedup rule that operates within a single evaluation:
if a user qualifies for the same competition through more than one relationship — relevant *and*
bookmarked — that produces **one** notification, not two. See
[`intents/registration-closing.md`](../intents/registration-closing.md).

Both rules are deduplication, but they answer different questions:

| Rule | Scope | Question |
| --- | --- | --- |
| History deduplication | Across evaluations | Have we already told this user this, for this reason? |
| Relationship deduplication | Within one evaluation | Is this user qualifying for the same thing twice? |
