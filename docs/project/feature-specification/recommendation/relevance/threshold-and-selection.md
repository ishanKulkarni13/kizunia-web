# Threshold, Ranking, and Top-N

> **Status:** Stable — Phase 0
>
> **Last Updated:** 2026-09-15
>
> **Rulings:** [RD-08](../decisions/README.md#rd-08), [RD-09](../decisions/README.md#rd-09)

These are three separate questions, kept separate on purpose — the same
separation the existing notification spec already establishes in
[`../../../architecture/notifications/recommendation/ranking-and-selection.md`](../../../architecture/notifications/recommendation/ranking-and-selection.md):

| Stage | Question | Owns |
| --- | --- | --- |
| Threshold | Is this good enough to show at all? | Quality |
| Ranking | Which is better than which? | Order |
| Top-N | How many do we return? | Quantity |

## Threshold is a floor, never relaxed

If `score >= threshold`, the candidate is eligible to be returned. If not,
it is discarded — permanently, for this evaluation. **The engine never
lowers the threshold to manufacture a fuller result.**

```text
threshold = 0.60, topN = 5

Only 2 candidates score >= 0.60 -> the result has 2 items.
The threshold is not relaxed to find 3 more.
```

The current default threshold is `0.5` — a candidate must clear at least
half of the weighted preference mass the user expressed. This is a starting
point, not a derived value; see
[`../../../architecture/recommendation/configuration.md`](../../../architecture/recommendation/configuration.md).

## Ranking is deterministic

Candidates that clear the threshold are ordered by score, descending. Ties
are broken deterministically:

```text
1. score, descending
2. registrationDeadline, ascending (nulls last)
3. startDate, ascending (nulls last)
4. id, ascending
```

No randomness. The date fields are used here purely as a tiebreaker — they
are not scored dimensions in Phase 0 (see
[`dimensions.md`](dimensions.md)).

## Top-N caps quantity, nothing else

Top-N is a result-selection limit applied **after** threshold and ranking,
never a substitute quality bar. The default is 5. Requesting `topN = 5`
when only 2 candidates cleared the threshold returns 2 — not 5 padded with
lower-quality results.
