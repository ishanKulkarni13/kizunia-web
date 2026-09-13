# Analytics and Tracking

> **Status:** Direction — Phase 1 tracking is deliberately minimal
>
> **Last Updated:** 2026-09-12

---

## What Phase 1 tracks

Three things:

- notification existence;
- delivery state;
- whether the user responded (clicked or opened).

That is all
([ND-H-08](../../../project/feature-specification/notification/decisions/history.md#nd-h-08--response-is-binary)).

---

## What the architecture must leave room for

Future tracking could reasonably include:

```text
generated · filtered · suppressed · delivered · opened · clicked
converted · registered · dismissed
ranking position · recommendation reason
algorithm/model version · experiment variant
```

> **Do not build all of this now.**

The requirement is narrow and specific:

> Future analytics and tracking should not require contaminating the core notification business
> logic.

---

## The one thing Phase 1 should do

**Carry rejection reasons in the processing context.**

When a filter rejects a candidate, it records why
([`../pipeline/filter-chain.md`](../pipeline/filter-chain.md)). When ranking orders candidates, the
position exists. When selection takes N, the ones not taken are known.

None of this is surfaced or persisted in Phase 1. It is carried because:

- it makes a pipeline run explainable while debugging;
- it is exactly the raw material the future vocabulary above needs — `filtered`, `suppressed`,
  `ranking position`, `recommendation reason`;
- **it cannot be reconstructed afterwards.** A candidate that was filtered out leaves no trace
  unless the trace is made at the time.

Carrying it costs almost nothing. Recovering it later costs a re-run of history that is no longer
possible, because preferences and competition data have moved on.

---

## How tracking attaches later

By **observing** pipeline outcomes, not by instrumenting business logic.

| Good | Bad |
| --- | --- |
| An observer consumes the completed context and emits events | Each stage calls an analytics service inline |
| Tracking failure cannot affect notification correctness | A tracking error aborts an evaluation |
| Tracking can be added, changed or removed without touching rules | Rules and instrumentation are interleaved |

The test: if removing all tracking changes which notifications get sent, the instrumentation is in
the wrong place.

---

## The dependency nobody notices until too late

**Experiments need tracking first.**

An A/B variant of the relevance algorithm
([`../recommendation/scoring-strategy.md`](../recommendation/scoring-strategy.md)) is not
analysable unless each run records which strategy produced its result and where each candidate
ranked.

So the sequence is: tracking, then experiments. Not the other way around. Worth knowing before
someone schedules the first experiment.

---

## Not in Phase 1

| Not built | Note |
| --- | --- |
| An events table or analytics store | No consumer exists |
| Per-notification interaction detail beyond `responded` | One bit answers the Phase 1 question |
| Which competition within an aggregated summary was clicked | Requires the aggregation storage decision first ([`../persistence/notification-storage.md`](../persistence/notification-storage.md)) |
| Conversion or registration attribution | Kizunia cannot observe external registration ([ND-I-16](../../../project/feature-specification/notification/decisions/intents.md#nd-i-16--recipient-rules-use-only-relationships-kizunia-knows)) |
| Dismissal | No dismiss interaction exists |

The fourth row is a permanent constraint, not a gap: Kizunia has no channel to confirm that a user
registered with an external organizer, so "conversion" can only ever mean a self-declared mark, not
an observed outcome.
