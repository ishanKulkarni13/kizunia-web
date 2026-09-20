# The Filter Chain

> **Status:** Design
>
> **Last Updated:** 2026-09-12

The notification architecture supports a modular filter/middleware model.

---

## The model

The conceptual direction is similar to middleware in systems such as Express:

> A processing stage receives the context produced by previous stages, can inspect that context,
> and may add additional context for subsequent stages.

```text
Stage A -> Filter/Middleware -> Stage B -> Filter/Middleware -> Stage C
```

A filter can:

- access the relevant accumulated context;
- evaluate conditions using information produced by previous stages;
- reject or allow processing where appropriate;
- add useful context for downstream stages.

This provides an extensible mechanism for introducing additional validation and business rules
later **without restructuring the entire notification pipeline**.

---

## The inspiration, and its limit

The processing model is strongly inspired by **Spring Security's filter-chain architecture**.

The goal is **not** to copy Spring Security's implementation. The goal is to adopt the
architectural property:

> A sequence of composable processing stages, each with a clearly defined responsibility, operating
> on shared context and allowing the pipeline to evolve.

What is borrowed: composability, a single well-defined chain, the ability to insert a filter at a
known position, and the ability for a filter to terminate processing.

What is not borrowed: Spring's registration machinery, its ordering annotations, its exception
translation model, or its vocabulary. Kizunia's filters are ordinary application code.

---

## What a filter is, and what it is not

A **filter** is a stage with a narrow, single-reason responsibility, most often rejection.

| A filter does | A filter does not |
| --- | --- |
| Evaluate one condition | Bundle several unrelated conditions |
| Reject, or pass through | Reorder, rank or score |
| Optionally add context explaining its decision | Mutate another stage's contribution |
| Work for any intent that composes it | Know which intent composed it, unless that is its purpose |

The Phase 1 candidate filters are the model:

| Filter | Rejects |
| --- | --- |
| Hard constraint filter | Candidates failing any weight-1 preference |
| Delivery history filter | Candidates already delivered for this `(user, intent)` |
| Registration-open filter | Candidates whose registration is not currently open |
| Marked-as-registered filter | Candidates the user says they registered for |

Each has one reason. Each is independently testable. Each can be composed into a different intent
that happens to need the same rule — the delivery history filter is used by every intent, while the
registration-open filter is specific to discovery.

---

## Composition, not configuration

An intent declares which filters it composes, in what order
([`../intents/intent-contract.md`](../intents/intent-contract.md)). The chain is not a global list
with per-intent conditionals inside each filter.

The difference matters:

```text
Good      TOP composes [registration-open, hard-constraints, delivery-history]
          CLOSING composes [deadline-window, relationship, marked-registered, hard-constraints]

Bad       every filter checks `if (intent === TOP) ...`
```

The second form reintroduces exactly the central conditional that intent-based extensibility exists
to avoid ([`../principles.md`](../principles.md)).

---

## Ordering

Most filter ordering is a performance choice: cheap, high-rejection filters first. That is free to
change.

**One ordering constraint is a correctness rule, not a preference:** all filtering runs before
relevance scoring
([ND-R-04](../../../project/feature-specification/notification/decisions/relevance.md#nd-r-04--candidate-filtering-runs-strictly-before-scoring)).
A filter must never be moved after scoring in an attempt to "let a good score win" — that is the
behavior the rule prohibits.

Where a filter's position is load-bearing, it should be stated explicitly rather than implied by
list order.

---

## Rejection is information

A filter that rejects should record **why**, into the context
([processing-context.md](processing-context.md)).

Phase 1 does not surface that anywhere. It is carried because:

- it makes a pipeline run explainable while debugging;
- it is the raw material for future tracking — filtered, suppressed, recommendation reason
  ([`../cross-cutting/analytics-and-tracking.md`](../cross-cutting/analytics-and-tracking.md));
- it cannot be reconstructed later.

---

## Phase 1 scope

> The system intentionally does **not** need to implement every possible validation filter.

For example, the final competition-status re-check before delivery is a **future filter**, not a
Phase 1 requirement
([ND-I-17](../../../project/feature-specification/notification/decisions/intents.md#nd-i-17--competition-state-is-not-re-validated-before-delivery-in-phase-1)).

The architecture must nevertheless make such filters possible later — which is precisely what this
chain is for. See [extension-points.md](extension-points.md).
