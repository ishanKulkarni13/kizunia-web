# Relevance

> **Status:** Stable
>
> **Last Updated:** 2026-09-12

Relevance is how Kizunia decides **which** competitions are worth telling a user about. It is a
ranking signal, not a verdict — what to do with the ranking belongs to each intent's notification
policy.

---

## The flow, once

```text
                    User Competition Preferences
                              │
                              ▼
                    Candidate Competitions
                              │
                              ▼
                    Apply Hard Constraints
                              │
                 ┌────────────┴────────────┐
               Fails                    Passes
                 │                         │
              Exclude                 Continue
                                           ▼
                              Calculate Relevance
                                           ▼
                                  Rank Candidates
                                           ▼
                              Apply Minimum Threshold
                                           ▼
                                 Notification Policy
                                           ▼
                                     Select Top N
                                           ▼
                                  Send Notification
```

Everything before "Calculate Relevance" is **filtering** — binary, and always first. Everything
after is **ranking and selection**.

---

## Documents

| Document | Contents |
| --- | --- |
| [relevance-model.md](relevance-model.md) | Relevance as a continuous signal; what is and is not decided about scoring |
| [candidate-filtering.md](candidate-filtering.md) | What is removed before scoring, and why the order is not negotiable |
| [missing-data.md](missing-data.md) | How `null` and mismatched competition values behave |
| [location-matching.md](location-matching.md) | Hierarchical geographic matching |
| [threshold-and-selection.md](threshold-and-selection.md) | The relevance floor, and how many candidates get selected |

---

## The two rules to remember

1. **Filtering before scoring.** A candidate that cannot participate must never be able to score
   its way back in.
2. **Never trade relevance for quantity.** The threshold is a floor. If fewer candidates clear it
   than the policy asked for, fewer are sent.

---

## What is deliberately undecided

The scoring formula itself, whether fields carry inherent importance, weight normalization, the
threshold's value, and the location algorithm are all open. See
[`open-decisions.md`](../open-decisions.md) and
[ND-R-07](../decisions/relevance.md#nd-r-07--the-scoring-formula-is-deliberately-undecided).

Everything the rest of the subsystem depends on is specified **without** the formula. That is what
makes the algorithm replaceable — see
[`scoring-strategy.md`](../../../../architecture/notifications/recommendation/scoring-strategy.md).
