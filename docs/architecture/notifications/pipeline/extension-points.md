# Extension Points

> **Status:** Design
>
> **Last Updated:** 2026-09-12

Where new behavior attaches. This is the practical test of the architecture: for each anticipated
change, what has to be touched?

---

## The extension map

| I want to | I add / replace | I must not touch |
| --- | --- | --- |
| Add a notification type | A new intent | Existing intents, the pipeline, persistence, delivery |
| Add an exclusion rule | A filter, composed into the intents that need it | The scorer, other filters |
| Change how relevance is computed | The scoring strategy | Persistence, delivery, preferences, queueing, any intent |
| Change how candidates are ordered | The ranking strategy | The scorer, selection |
| Change how many are selected | The intent's selection policy | Relevance, threshold |
| Change how items are grouped | The intent's aggregation policy | Generation, delivery |
| Add a delivery channel | A delivery adapter | Generation, the pipeline, any intent |
| Add a trigger source | A trigger adapter | The evaluation logic |
| Gate a capability by plan or flag | A capability check at user eligibility | Anything else |
| Record a new tracking event | An observer of pipeline outcomes | Core business logic |

If any change in the left column requires touching something in the right column, the boundary
is wrong.

---

## The canonical test: pre-delivery validation

Phase 1 does **not** re-check competition state before delivery. A notification for a competition
cancelled after generation is still sent
([ND-I-17](../../../project/feature-specification/notification/decisions/intents.md#nd-i-17--competition-state-is-not-re-validated-before-delivery-in-phase-1)).

This is the architecture's own stated example of a future filter, which makes it the fairest test
of whether the pipeline actually extends.

**Adding it later should mean:**

- writing one filter that reads the candidate's current competition state and rejects if it is
  cancelled or otherwise invalid;
- inserting it into the chain after generation and before delivery;
- composing it into the intents that want it.

**It should not mean:**

- teaching the delivery layer about competitions;
- adding a conditional to notification generation;
- changing the notification record's shape;
- touching either existing intent's rules.

If, when the time comes, it cannot be done the first way, this design failed and should be revised
rather than worked around.

---

## Other named future extensions

Each of these is expected. None is built.

### A new notification intent

The full checklist is in [`../intents/adding-an-intent.md`](../intents/adding-an-intent.md). The
first non-competition intent — portfolio contact notifications — is the real test, because it has
no relevance, no ranking and no aggregation, and exercises a very different path
([`future/notification-intents.md`](../../../project/feature-specification/notification/future/notification-intents.md)).

### An ML or experiment-varied relevance model

Attaches as a scoring strategy
([`../recommendation/scoring-strategy.md`](../recommendation/scoring-strategy.md)). Nothing
downstream reads the score's internals, which is what makes this a substitution rather than a
migration.

Note the dependency: a meaningful experiment needs algorithm version and ranking position recorded,
which is future tracking that does not exist yet.

### Cross-intent volume limits

A cap on total notification activity per user per period (US-26). This is a **limit**, not
deduplication, and it is the one anticipated extension that genuinely spans intents — it cannot live
inside a single intent's filter set.

Its likely home is a stage between generation and delivery, evaluating a user's recent notification
history. It is named here because it is the extension most likely to strain the "intents are
independent" rule
([ND-H-07](../../../project/feature-specification/notification/decisions/history.md#nd-h-07--different-intents-are-independent))
and should be designed deliberately rather than improvised.

### Entitlement and feature-flag gating

Attaches at user eligibility, where the intent flow already names *"required capability is
available"* as a check
([`../cross-cutting/feature-flags-and-entitlements.md`](../cross-cutting/feature-flags-and-entitlements.md)).

### Additional channels

Attach as delivery adapters behind the generation/delivery split
([`../delivery/clients-and-channels.md`](../delivery/clients-and-channels.md)).

### Richer analytics

Attaches by observing pipeline outcomes and the rejection reasons the context already carries —
without contaminating core notification business logic
([`../cross-cutting/analytics-and-tracking.md`](../cross-cutting/analytics-and-tracking.md)).

---

## The discipline that keeps extension points real

An extension point that is never exercised is a guess. Two rules keep them honest:

**Do not build extension points for changes nobody has named.** Every point on this page
corresponds to a change that was explicitly anticipated during design. An abstraction without a
named anticipated change is the "40 interfaces because interfaces are enterprise" failure
([`../principles.md`](../principles.md)).

**Do not implement future functionality simply because the architecture supports it.** An
extension point being ready is not a reason to use it. Phase 1 remains two intents
([`phase-1/boundaries.md`](../../../project/feature-specification/notification/phase-1/boundaries.md)).
