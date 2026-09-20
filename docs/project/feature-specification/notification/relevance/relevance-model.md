# The Relevance Model

> **Status:** Stable
>
> **Last Updated:** 2026-09-12
>
> **Rulings:** [ND-R-01](../decisions/relevance.md#nd-r-01--relevance-is-a-ranking-not-a-verdict),
> [ND-R-03](../decisions/relevance.md#nd-r-03--selection-count-belongs-to-the-notification-policy),
> [ND-R-07](../decisions/relevance.md#nd-r-07--the-scoring-formula-is-deliberately-undecided)

---

## Relevance is a ranking, not a verdict

Kizunia does not treat relevance as one universal binary decision. The matching system produces a
continuous signal that orders candidates:

```text
Competition A  ->  0.94
Competition B  ->  0.87
Competition C  ->  0.71
Competition D  ->  0.32
```

There is no single "relevant / not relevant" line baked into the scorer. The notification policy
decides what to do with the ordering, based on the purpose of that particular notification.

### Why not a boolean

Different intents want different things from the same ranking. A discovery notification wants the
single best candidate; an aggregated deadline summary wants the top few. A binary answer cannot
serve both, and tuning a shared boolean would mean re-tuning it every time a new intent is added.

Keeping relevance continuous means new intents are cheap: they choose a selection policy, not a
new scorer.

---

## Relevance is computed against current preferences

Every evaluation uses the user's preference profile **as it stands at that moment**. Past
configurations do not influence the current run.

```text
Monday    preferences: AI 0.9
Tuesday   user changes to: Design 0.9

Tuesday's evaluation uses Design 0.9
```

Historical notification records are preserved independently and are not re-interpreted against old
preferences. See
[ND-H-05](../decisions/history.md#nd-h-05--each-evaluation-uses-current-preferences).

---

## Relevance and notification history are separate questions

A competition that has already been notified about for a given intent may still be highly relevant,
and it remains in the ranking.

```text
Previous discovery prevents a repeated discovery notification.
Previous discovery does not make the competition irrelevant.
```

Removing previously notified competitions from the ranking itself would corrupt the ranking and
leak one intent's history into every other intent that consumes relevance. Suppression happens at
the candidate-filtering and policy layers, not inside the score. See
[ND-H-09](../decisions/history.md#nd-h-09--previously-notified-competitions-may-still-rank) and
[candidate-filtering.md](candidate-filtering.md).

---

## What relevance is made of

Relevance is computed from the user's competition preference profile against the competition's
attributes:

- Soft preference matches raise relevance.
- Soft preference mismatches and missing values lower it, without excluding
  ([missing-data.md](missing-data.md)).
- Hard constraints do not participate in scoring at all — they have already excluded their
  failures before scoring begins
  ([candidate-filtering.md](candidate-filtering.md)).

---

## What is deliberately not specified

The following are **open decisions**, not oversights:

| Open | Why it is open |
| --- | --- |
| The exact scoring formula | Most likely part of the system to change, and eventually to become learned |
| Whether some fields have inherent importance regardless of user weight | Requires data Kizunia does not have yet |
| How weights are normalized | Depends on the formula |
| The minimum threshold's value | Depends on the formula's output distribution |
| How often relevance matching runs beyond the Phase 1 daily job | Depends on cost, measured once it exists |

These are tracked in [`open-decisions.md`](../open-decisions.md).

### Why this is safe to leave open

Everything the rest of the subsystem depends on is specified without the formula:

- relevance produces an **ordering** (this document);
- filtering runs **before** scoring ([candidate-filtering.md](candidate-filtering.md));
- a **floor** applies ([threshold-and-selection.md](threshold-and-selection.md));
- **selection count** belongs to the policy ([threshold-and-selection.md](threshold-and-selection.md)).

Nothing downstream reads the score's internals. That is precisely the property that lets the
algorithm be replaced — by a better deterministic scorer, an experiment variant, or an ML model —
without touching notification persistence, delivery, preferences, queueing or any other intent.
See [`scoring-strategy.md`](../../../../architecture/notifications/recommendation/scoring-strategy.md).
