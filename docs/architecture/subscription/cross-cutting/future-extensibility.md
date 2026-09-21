# Future Extensibility

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

Product-facing direction is in
[`../../../project/feature-specification/subscription/future.md`](../../../project/feature-specification/subscription/future.md).
This page states the architectural seams that make each of those additions non-disruptive, without
building any of them now.

---

| Future addition | Seam that already accommodates it |
| --- | --- |
| One-time purchases | A new entitlement-source concept, resolved the same way `EntitlementGrant` is today — effective-access resolution already takes a max over multiple sources, not just two |
| A second billing provider | Implements the same [`interface-and-abstraction.md`](../provider-boundary/interface-and-abstraction.md) interface; nothing above the provider boundary changes |
| Finer-grained MCP entitlement | The existing MCP scope model is already extensible; entitlement checks plug in as additional `PlatformAction`/permission checks the same way the initial boolean does |
| Coupon stacking or a richer promotion framework | Both current mechanisms (Offer, Promotion) stay as-is; a richer framework would be additive, not a replacement, if it is ever built |
| Repeatable/multiple trials with a cooldown | Purely a Kizunia-side eligibility check before calling `createSubscription` with a trial `start_at` — no change to the trial mechanism itself |
| More plans, including an "unlimited" tier | A new catalog entry in the Plan → capability mapping; an internal safety ceiling is a rate-limit-style concern, not a change to how plans are modeled |

None of these are scheduled. Each is listed here because building them later should mean adding to
this design, not restructuring it.
