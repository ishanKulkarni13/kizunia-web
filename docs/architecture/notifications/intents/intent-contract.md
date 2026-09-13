# The Intent Contract

> **Status:** Design
>
> **Last Updated:** 2026-09-12

An intent supplies the behavior that varies, and inherits everything that does not. That split is
what makes adding an intent an addition rather than an edit.

---

## What varies, and what is inherited

From [`../pipeline/stages.md`](../pipeline/stages.md):

| Stage | Supplied by the intent | Inherited |
| --- | --- | --- |
| Context initialization | | ✓ |
| User eligibility | Which checks apply | The mechanism |
| Candidate selection | **The candidate rule** | |
| Candidate filtering | **Which filters, in what order** | The chain mechanism |
| Preference matching | | ✓ |
| Relevance scoring | Whether it participates at all | The strategy |
| Threshold | | ✓ |
| Ranking | | ✓ (strategy) |
| Selection | **The selection policy** | |
| Aggregation | **The aggregation policy** | |
| Generation | | ✓ |
| Queue and delivery | | ✓ |

Four bold rows. That is the contract's real surface.

---

## The contract

Every intent declares:

### Identity

A stable name. It appears in notification records, in preferences and in deduplication keys, so it
outlives any refactor.

### Trigger declaration

What causes an evaluation — a schedule, an event, an admin action. The intent **declares** its
trigger; it does not implement it. The trigger mechanism stays separate from the logic
([`../triggers/README.md`](../triggers/README.md)).

### User eligibility checks

Which conditions gate participation: the preference toggle, whether a competition preference
profile is required, which capability is required.

`TOP_RELEVANT_COMPETITION` requires a preference profile; a future portfolio-contact intent would
not.

### Candidate rule

How the working set is produced for one user. See
[`../recommendation/candidate-selection.md`](../recommendation/candidate-selection.md).

### Filter composition

Which filters run, in what order. Filters are shared, composable units; the intent composes them
rather than containing them
([`../pipeline/filter-chain.md`](../pipeline/filter-chain.md)).

```text
TOP      [registration-open, hard-constraints, delivery-history]
CLOSING  [deadline-window, relationship, marked-registered, hard-constraints]
```

The delivery-history filter is shared by every intent and parameterized by the intent's own
identity — which is how deduplication stays scoped to the intent without any intent knowing about
the others.

### Selection policy

How many ranked candidates to take, and under what bounds. See
[`../recommendation/ranking-and-selection.md`](../recommendation/ranking-and-selection.md).

### Aggregation policy

How the selection becomes user-facing notifications. See
[`../recommendation/aggregation.md`](../recommendation/aggregation.md).

### Deduplication scope

What suppresses a future notification of this intent. For both Phase 1 intents this is the
`(user, competition, intent)` triple on **delivered** notifications
([ND-H-03](../../../project/feature-specification/notification/decisions/history.md#nd-h-03--delivered-consumes-the-triple-undelivered-does-not)).

An intent may need a different scope — a deadline-event scope rather than a lifetime scope, for
instance — so this is declared rather than assumed.

### Preference surface

What the user can configure: the on/off toggle every intent has, plus any intent-specific setting
such as the `REGISTRATION_CLOSING` maximum.

---

## Not every intent uses every stage

A future portfolio-contact notification has no relevance, no ranking, no threshold and no
aggregation — an event names its recipient and its subject directly.

That intent must not be forced to supply no-op implementations of stages it does not use, and must
not require a second pipeline. **Whether unused stages are skipped by declaration, or expressed as
a shorter chain, is an implementation choice** — but the requirement stands: the first
non-competition intent is the real test of this contract, and it should not need the subsystem
restructured
([`../pipeline/extension-points.md`](../pipeline/extension-points.md)).

---

## What the contract must not include

| Not in the contract | Why |
| --- | --- |
| Delivery mechanism or channel | Generation is separate from delivery ([`../delivery/generation-vs-delivery.md`](../delivery/generation-vs-delivery.md)) |
| Storage shape | Persistence is shared ([`../persistence/notification-storage.md`](../persistence/notification-storage.md)) |
| The scoring formula | Scoring is a swappable shared strategy ([`../recommendation/scoring-strategy.md`](../recommendation/scoring-strategy.md)) |
| Knowledge of other intents | Intents are independent ([ND-H-07](../../../project/feature-specification/notification/decisions/history.md#nd-h-07--different-intents-are-independent)) |
| The trigger's implementation | Triggers are not logic ([`../triggers/README.md`](../triggers/README.md)) |
| Presentation copy | Content and templating are undecided ([`open-decisions.md`](../../../project/feature-specification/notification/open-decisions.md)) |

An intent that needs any of these is a signal that a shared concern has been drawn at the wrong
boundary.
