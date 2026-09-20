# Cross-Cutting Concerns

> **Status:** Design — room left, nothing built
>
> **Last Updated:** 2026-09-12

Concerns that touch every stage rather than living in one. For all of them the Phase 1 instruction
is the same:

> **Leave room. Build none of it.**

| Document | Contents |
| --- | --- |
| [feature-flags-and-entitlements.md](feature-flags-and-entitlements.md) | Making a capability flagged, experimental or plan-dependent |
| [analytics-and-tracking.md](analytics-and-tracking.md) | A tracking vocabulary that can grow without contaminating business logic |
| [failure-and-idempotency.md](failure-and-idempotency.md) | What happens when an evaluation fails or re-runs |

---

## The shared requirement

Each of these is a category of change that is confidently expected and deliberately not
implemented. The architecture is judged on whether adding them later is cheap — not on whether it
anticipated their details.

The failure mode to avoid in both directions
([`../principles.md`](../principles.md)):

| Over-building | Under-building |
| --- | --- |
| An experiment framework for one algorithm | Business logic that cannot be varied per user |
| An analytics pipeline with no consumer | Decisions made and then discarded, unrecoverable |
| An entitlement system with nothing to sell | A capability check that cannot be inserted without touching every stage |

---

## Why these three, and not others

Each corresponds to something already true of the design:

**Flags and entitlements** — the intent flow already names *"required capability is available"* as
a user-eligibility check, satisfied trivially for everyone in Phase 1. The seam is named before
there is anything to put in it.

**Analytics** — the pipeline already produces the information (rejection reasons, ranking positions)
that future tracking would need, and that information cannot be reconstructed after the fact.

**Failure and idempotency** — not optional. The cron platform can re-invoke a job whose response
indicated failure, so re-runs are a certainty rather than an edge case.
