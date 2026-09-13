# Ranking and Selection

> **Status:** Design
>
> **Last Updated:** 2026-09-12

Three responsibilities that are easy to merge and must not be:

| Stage | Owns | Question |
| --- | --- | --- |
| **Threshold** | Quality | Is this good enough to send at all? |
| **Ranking** | Order | Which is better than which? |
| **Selection** | Quantity | How many do we take? |

Merging quality and quantity is how a recommendation system starts padding its output.

---

## Threshold

Applies the minimum relevance floor. Candidates below it are gone.

The threshold is **never** lowered to reach a target count
([ND-R-02](../../../project/feature-specification/notification/decisions/relevance.md#nd-r-02--the-minimum-threshold-is-a-floor-never-lowered-for-quota)).
If a policy wants five and three qualify, three are sent. If none qualify, nothing is sent, and that
is a correct outcome
([ND-I-05](../../../project/feature-specification/notification/decisions/intents.md#nd-i-05--a-scheduled-run-is-not-a-reason-to-notify)).

Structurally, this is why threshold is its own stage rather than a clause inside selection: a
selection policy that owned the floor could relax it, and eventually would.

**Open:** the threshold's value, and whether it is global, per-intent or per-user. It cannot
sensibly be chosen before the scoring formula exists
([scoring-strategy.md](scoring-strategy.md)).

---

## Ranking

Orders the survivors.

Separated from scoring so that ordering strategy can change without touching the scorer. Concerns
that belong here rather than in the score:

- **tie-breaking** — deterministic, so repeated runs are reproducible;
- **recency or urgency bias** — for `REGISTRATION_CLOSING`, how close the deadline is may matter
  independently of relevance;
- **diversity** — avoiding a summary composed of five near-identical competitions.

None of these are specified for Phase 1. They are named because each is a plausible future change
that must not require a new scorer.

---

## Selection

Takes as many as the notification policy wants.

> **Relevance produces the ranking; notification policy determines how many ranked candidates to
> select.**

The count is bounded by three things:

```text
min(
  the policy's target,
  the user's configured maximum (where the intent has one),
  candidates clearing the threshold
)
```

The third bound is the one that must never be relaxed.

### Phase 1 selection policies

| Intent | Policy |
| --- | --- |
| `TOP_RELEVANT_COMPETITION` | Take exactly 1. No user-configurable volume ([ND-I-06](../../../project/feature-specification/notification/decisions/intents.md#nd-i-06--top_relevant_competition-selects-exactly-one-competition)) |
| `REGISTRATION_CLOSING` | Take the top 3 to 5, bounded by the user's configured maximum ([ND-P-13](../../../project/feature-specification/notification/decisions/preferences.md#nd-p-13--registration_closing-exposes-a-user-configurable-maximum)) |

Selection policy is per-intent behavior supplied through the intent contract
([`../intents/intent-contract.md`](../intents/intent-contract.md)) — not a parameter on a shared
function with intent-aware branches.

---

## Why selection is a policy and not a number

A "top N" parameter would cover both Phase 1 intents and would be the obvious simplification. It is
rejected because the anticipated variation is not numeric:

- a digest intent may want N *subject to diversity*;
- a deadline intent may want *everything urgent*, with N only as a safety bound;
- an admin-triggered intent may want an explicit set with no ranking at all;
- an event-driven intent may select exactly the thing the event named.

A policy expresses all of those. A number expresses one of them and grows flags for the rest.

---

## Ranking survives deduplication

A competition already delivered for an intent is removed at **candidate filtering**, before
scoring — it is not down-ranked
([ND-H-09](../../../project/feature-specification/notification/decisions/history.md#nd-h-09--previously-notified-competitions-may-still-rank)).

The consequence for this stage: ranking never needs to know about notification history, and must
not be given a penalty term for it. A previously surfaced competition that is still eligible for a
*different* intent ranks on its merits.
