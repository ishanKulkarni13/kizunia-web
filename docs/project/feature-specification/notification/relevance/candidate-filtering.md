# Candidate Filtering

> **Status:** Stable
>
> **Last Updated:** 2026-09-12
>
> **Rulings:** [ND-R-04](../decisions/relevance.md#nd-r-04--candidate-filtering-runs-strictly-before-scoring),
> [ND-P-08](../decisions/preferences.md#nd-p-08--weight-1-is-a-hard-constraint-applied-before-scoring)

Competitions that cannot participate in a particular notification decision are removed **before**
relevance is calculated.

---

## The order

```text
All competitions
        │
        ▼
Hard constraints
        │
        ▼
Already notified for this reason (delivered)
        │
        ▼
Other applicable exclusion rules
        │
        ▼
Eligible candidates
        │
        ▼
Calculate relevance
        │
        ▼
Rank
        │
        ▼
Apply minimum threshold
        │
        ▼
Select Top N
        │
        ▼
Notify
```

This order is not an optimization detail. It is a correctness rule with an efficiency benefit.

---

## Why filtering must come first

### Correctness

A candidate that fails a hard constraint must not be able to score its way back in on the strength
of other attributes. If hard constraints were applied as part of scoring, a competition with a
great interest match and the wrong mode could outrank one that satisfies the user's stated
requirement — which would make weight `1` mean something weaker than it says.

The same reasoning applies to history-based exclusion: a competition the user has already been
told about for this intent is ineligible regardless of how well it scores.

### Efficiency

Relevance scoring is the expensive stage. Kizunia should not spend scoring resources on candidates
already known to be impossible. As the competition catalogue grows, the ratio of filtered-out to
scored candidates only improves.

---

## What gets filtered

| Filter | Removes | Owned by |
| --- | --- | --- |
| **Hard constraints** | Competitions failing any weight-1 preference, including those with `null` on a hard-constrained field | [`preferences/weights-and-constraints.md`](../preferences/weights-and-constraints.md) |
| **Intent eligibility** | Competitions that do not satisfy the intent's own precondition — for example, registration not currently open for `TOP_RELEVANT_COMPETITION` | [`intents/`](../intents/README.md) |
| **Notification history** | Competitions already **delivered** to this user for **this intent** | [`history/deduplication.md`](../history/deduplication.md) |
| **Relationship exclusions** | Competitions excluded by an intent's recipient rules — for example, marked-as-registered for `REGISTRATION_CLOSING` | [`intents/registration-closing.md`](../intents/registration-closing.md) |

Each filter is independent and each belongs to a clearly identified owner. New exclusion rules are
expected over time; they are added as additional filters rather than as conditions inside the
scorer. See [`filter-chain.md`](../../../../architecture/notifications/pipeline/filter-chain.md).

---

## User eligibility is not candidate filtering

Two different questions, easy to conflate:

| Question | About | Example |
| --- | --- | --- |
| **User eligibility** | The *user* | Is this intent enabled? Is there a preference profile? Is the required capability available? |
| **Candidate filtering** | The *competitions* | Is registration open? Has this already been delivered? Does it fail a hard constraint? |

User eligibility runs first and short-circuits everything: an ineligible user produces no
candidates at all, so no scoring happens for them.

---

## Filtering is not ranking

Filtering is binary and produces a set. Ranking is continuous and produces an order. A filter never
"lowers" anything; it removes or it does not.

The one case that looks like an exception is not one: a **soft** preference mismatch does not
filter — it lowers relevance and the competition remains a candidate. Only **hard** constraints
filter. See [missing-data.md](missing-data.md).
