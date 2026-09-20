# Pipeline Stages

> **Status:** Design
>
> **Last Updated:** 2026-09-12

Each stage's responsibility, what it consumes, and what it contributes. Stages are described by
**responsibility**, not by class — several may collapse into one unit where no change is expected,
and one may split where change is.

---

## The sequence

```text
Trigger
    │  something caused an evaluation to run
    ▼
Context initialization
    │  intent, run identity, evaluation time
    ▼
User eligibility
    │  may this user receive this intent at all?
    ▼
Candidate selection
    │  which subjects are in scope for this evaluation?
    ▼
Candidate filtering
    │  remove what cannot participate
    ▼
Preference matching
    │  apply the user's preference profile
    ▼
Relevance scoring
    │  produce a ranking signal
    ▼
Threshold
    │  drop everything below the floor
    ▼
Ranking
    │  order what remains
    ▼
Selection
    │  take as many as the policy wants
    ▼
Aggregation
    │  combine into user-facing notifications
    ▼
Generation
    │  create notification records
    ▼
Queue
    │  hand off
    ▼
Delivery
```

---

## Stage responsibilities

### Trigger

Not a pipeline stage — the thing that starts one. A scheduled job, an admin action, or a future
domain event. The trigger is not part of the business logic's contract
([`../triggers/README.md`](../triggers/README.md)).

### Context initialization

Establishes the evaluation's identity: which intent is running, when "now" is for this run, and any
run-level identity needed for traceability.

**Why "now" is established once:** a run that reads the clock at several stages can make
inconsistent decisions about deadlines. The evaluation timestamp is context, not ambient state.

### User eligibility

**Question:** may this user receive this intent at all?

Checks, per intent:

- is the intent enabled in the user's notification preferences?
- does the user have a competition preference profile, where the intent requires one?
- is the required capability available to this user?
  ([`../cross-cutting/feature-flags-and-entitlements.md`](../cross-cutting/feature-flags-and-entitlements.md))

An ineligible user short-circuits the entire pipeline — no candidates are selected and nothing is
scored. This is the cheapest possible rejection and it must stay first.

**Not to be confused with** candidate filtering, which is about competitions, not users.

### Candidate selection

**Question:** which subjects are in scope for this evaluation?

Produces the working set. The set differs sharply per intent:

| Intent | Candidate rule |
| --- | --- |
| `TOP_RELEVANT_COMPETITION` | Competitions whose registration is currently open |
| `REGISTRATION_CLOSING` | Competitions approaching their registration deadline, related to the user by relevance or bookmark |

This is the stage with the most serious cost implications, and it has open decisions attached. See
[`../recommendation/candidate-selection.md`](../recommendation/candidate-selection.md).

### Candidate filtering

**Question:** what cannot participate?

Removes candidates for reasons that are binary and independent of score:

- hard constraint failures from the preference profile;
- already **delivered** to this user for this intent;
- intent-specific exclusions, such as marked-as-registered for `REGISTRATION_CLOSING`.

Each exclusion is a separate filter with a single reason. New exclusion rules are added here as new
filters, never as conditions inside the scorer
([filter-chain.md](filter-chain.md)).

### Preference matching

Applies the user's competition preference profile to each surviving candidate, producing the
per-field match information relevance consumes.

Separated from scoring because *what matched* and *how good that is* change for different reasons —
and because the former is exactly the data a future "why did I get this?" explanation needs.

### Relevance scoring

**Question:** how good is each candidate?

Produces a continuous signal. Nothing downstream reads its internals — that is what makes it
replaceable ([`../recommendation/scoring-strategy.md`](../recommendation/scoring-strategy.md)).

### Threshold

Drops candidates below the minimum relevance floor. Separate from selection, because the floor is
about **quality** and selection is about **quantity** — and conflating them is how a system starts
padding results
([`threshold-and-selection.md`](../../../project/feature-specification/notification/relevance/threshold-and-selection.md)).

### Ranking

Orders the survivors. Separate from scoring so that ordering strategy — ties, recency bias,
diversity — can change without touching the scorer.

### Selection

Takes as many as the notification policy wants, bounded by the user's configured maximum where the
intent has one. Never lowers the threshold to reach a target.

### Aggregation

Combines the selection into user-facing notifications. `TOP_RELEVANT_COMPETITION` selects one and
aggregates nothing; `REGISTRATION_CLOSING` combines several into one summary
([`../recommendation/aggregation.md`](../recommendation/aggregation.md)).

### Generation

Creates notification records — the occurrence, with its subject, intent, creation time and initial
delivery and response state
([`../persistence/notification-storage.md`](../persistence/notification-storage.md)).

**Generation is the boundary.** Everything before it decides *whether a notification should exist*.
Everything after it deals with *getting it to the user*.

### Queue and delivery

Covered in [`../delivery/README.md`](../delivery/README.md). Note that the repository has no queue
infrastructure today, which is a blocking open decision.

---

## Which stages are shared and which are per-intent

The pipeline is shared. What varies per intent is the **behavior plugged into it**.

| Stage | Shared or per-intent |
| --- | --- |
| Context initialization | Shared |
| User eligibility | Shared mechanism, intent-specific checks |
| Candidate selection | **Per-intent** |
| Candidate filtering | Shared mechanism, composed filter set per intent |
| Preference matching | Shared |
| Relevance scoring | Shared strategy, swappable |
| Threshold | Shared |
| Ranking | Shared strategy |
| Selection | **Per-intent policy** |
| Aggregation | **Per-intent policy** |
| Generation | Shared |
| Queue and delivery | Shared |

The per-intent rows are exactly the intent contract
([`../intents/intent-contract.md`](../intents/intent-contract.md)). An intent supplies those and
inherits the rest — which is what makes adding one an addition rather than an edit.

---

## Stages that do not exist yet

Phase 1 deliberately omits a **pre-delivery validation** stage that would re-check competition state
immediately before delivery
([ND-I-17](../../../project/feature-specification/notification/decisions/intents.md#nd-i-17--competition-state-is-not-re-validated-before-delivery-in-phase-1)).

It is named here because it is the canonical test of whether this pipeline actually extends: adding
it later should mean inserting a filter, not restructuring delivery. See
[extension-points.md](extension-points.md).
