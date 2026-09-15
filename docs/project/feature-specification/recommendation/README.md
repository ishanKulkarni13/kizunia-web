# Competition Recommendation — Phase 0

> **Status:** Stable — Phase 0
>
> **Version:** 1.0
>
> **Audience:** Product, engineering, whoever builds Phase 1 Notifications
>
> **Last Updated:** 2026-09-15

This directory specifies **Phase 0**: the Competition Recommendation Engine.
Its entire contract is one function of one input:

```text
userId -> RecommendationResult
```

Given a user, produce a ranked, relevance-scored list of the competitions
Kizunia should consider showing or notifying them about. Nothing about
*whether* or *how* that becomes a notification is decided here — that is
Phase 1, specified separately under
[`../notification/`](../notification/README.md). See
[`phase-relationship.md`](phase-relationship.md) for exactly how the two
connect.

---

## Why this is its own capability

The existing Notification specification already establishes, as a
principle, that recommendation and notification are separate
responsibilities:

> Recommendation -> "What should be recommended to this user?"
> Notification -> "Should this recommendation become a notification, and how
> is it handled?"
>
> — [`../../../architecture/notifications/principles.md`](../../../architecture/notifications/principles.md), Principle 3

Phase 0 makes that boundary structural rather than aspirational: the
recommendation engine is built, tested and usable **before** any
notification logic exists, as a module Phase 1 depends on rather than
reimplements.

---

## Documents in this tree

| Document | Contents |
| --- | --- |
| [`scope.md`](scope.md) | Exactly what Phase 0 does |
| [`non-goals.md`](non-goals.md) | Exactly what Phase 0 does not do |
| [`preferences/weights-and-constraints.md`](preferences/weights-and-constraints.md) | No preference / soft / hard semantics |
| [`preferences/multiple-values.md`](preferences/multiple-values.md) | Multiple values within one dimension |
| [`preferences/missing-data.md`](preferences/missing-data.md) | The missing-competition-data mismatch rule |
| [`preferences/phase-0-dummy-profile.md`](preferences/phase-0-dummy-profile.md) | Why Phase 0 uses a hardcoded profile, and what it is |
| [`relevance/dimensions.md`](relevance/dimensions.md) | The dimension list, mapped to the real domain |
| [`relevance/location-matching.md`](relevance/location-matching.md) | What "location match" means in Phase 0 |
| [`relevance/scoring.md`](relevance/scoring.md) | The chosen formula, in product terms |
| [`relevance/threshold-and-selection.md`](relevance/threshold-and-selection.md) | Threshold and Top-N semantics |
| [`decisions/README.md`](decisions/README.md) | Rulings made in Phase 0 (`RD-*`) |
| [`phase-relationship.md`](phase-relationship.md) | How Phase 1 consumes Phase 0 |

Technical architecture (pipeline shape, module layout, the engine's
internals) lives in
[`docs/architecture/recommendation/`](../../../architecture/recommendation/README.md),
per the existing convention that a behavioral rule belongs here and a
structural rule belongs there.

## Guiding principle

Every fact has exactly one owning document. Where this tree and the
Notification tree would otherwise both describe the same rule, one of them
links to the other rather than restating it — see
[`phase-relationship.md`](phase-relationship.md) for the seams.
