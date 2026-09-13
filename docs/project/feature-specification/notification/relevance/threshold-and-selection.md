# Threshold and Selection

> **Status:** Stable
>
> **Last Updated:** 2026-09-12
>
> **Rulings:** [ND-R-02](../decisions/relevance.md#nd-r-02--the-minimum-threshold-is-a-floor-never-lowered-for-quota),
> [ND-R-03](../decisions/relevance.md#nd-r-03--selection-count-belongs-to-the-notification-policy)

Two separate mechanisms decide what actually gets sent. Confusing them is the most common way a
recommendation system starts sending mediocre suggestions.

| Mechanism | Owns | Answers |
| --- | --- | --- |
| **Minimum relevance threshold** | Quality | Is this good enough to be worth sending at all? |
| **Notification policy** | Quantity | How many of the good-enough ones do we send? |

---

## The threshold is a floor

A minimum relevance threshold exists as a **floor**. A competition must be relevant enough to be
considered for recommendation at all.

The threshold does **not** determine how many competitions are sent.

```text
Requested: top 5

Competitions above the minimum threshold:
  A
  B
  C

Kizunia sends: A, B, C
```

It does **not** lower the threshold to find five.

> **Kizunia should never sacrifice relevance merely to satisfy a requested recommendation
> quantity.**

### Why this matters more than it looks

Quota-filling is self-reinforcing. The first time the system lowers the bar to fill a slot, the
user gets one weak recommendation. The tenth time, the user has learned that Kizunia's
notifications are padding, and stops opening them — at which point even the good recommendations
stop working.

Sending three when five were requested is a correct outcome. Sending nothing at all is also a
correct outcome
([ND-I-05](../decisions/intents.md#nd-i-05--a-scheduled-run-is-not-a-reason-to-notify)).

---

## Selection belongs to the notification policy

Relevance produces the ranking. How many ranked candidates are taken depends on the purpose of the
notification.

### One highly relevant competition

```text
A -> 0.94
B -> 0.87
C -> 0.71

Policy: single best
Selects: A
```

provided A crosses the minimum threshold. This is the `TOP_RELEVANT_COMPETITION` policy — it takes
exactly one
([ND-I-06](../decisions/intents.md#nd-i-06--top_relevant_competition-selects-exactly-one-competition)).

### Top N recommendations

```text
A -> 0.94
B -> 0.87
C -> 0.82
D -> 0.78
E -> 0.74
F -> 0.31

Policy: top 5
Selects: A, B, C, D, E
```

assuming all five satisfy the minimum threshold. F is not selected — not because the quota filled,
but because it is below the floor.

This is the `REGISTRATION_CLOSING` shape: take the top N that clear the floor, bounded by the
user's configured maximum, then aggregate into one notification
([ND-I-13](../decisions/intents.md#nd-i-13--registration_closing-aggregates-into-one-summary)).

> **Relevance produces the ranking; notification policy determines how many ranked candidates to
> select.**

---

## The three numbers that bound a selection

For any intent, the number of items sent is:

```text
min(
  policy's target N,
  user's configured maximum (where the intent has one),
  candidates clearing the minimum threshold
)
```

The last term is the one that must never be relaxed.

---

## What is open

The threshold's actual **value** is not decided, and cannot sensibly be decided before the scoring
formula exists — a floor of `0.6` means nothing until the score's distribution is known. Whether
the threshold is global, per-intent, or per-user is likewise open.

See [`open-decisions.md`](../open-decisions.md).

What is fixed is the threshold's **role**: a floor, applied after ranking, never lowered to fill a
quota.
