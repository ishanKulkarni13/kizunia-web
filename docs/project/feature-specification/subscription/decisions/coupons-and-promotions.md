# Rulings — Coupons and Promotions

> **Status:** Live
>
> **Last Updated:** 2026-09-21

---

## SB-CP-01 — Billing discounts use Offers; free-access grants use Promotions; never conflated

**Status:** Accepted

**Decision:** See [`../coupons-and-promotions.md`](../coupons-and-promotions.md) for the full
statement. A real, ongoing paid subscription that happens to be discounted is a Razorpay **Offer**.
Free plan-level access with no real subscription behind it is a Kizunia **Promotion**, modeled
identically to an [admin grant](../admin-grants.md).

**Rationale:** [RAZORPAY FACT] Razorpay has no concept of a Kizunia user account, and therefore no
way to represent "give this Kizunia account free access" as a billing construct — its Offers are
scoped to payment instruments (cards, UPI handles), not to Kizunia identities (see
[`../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../architecture/subscription/provider-boundary/razorpay-facts.md#offers)).
The earlier feasibility research identified attempting to force a free-access grant through a
Razorpay discount as the single largest risk in the coupon area; modeling it as an `EntitlementGrant`
instead — the exact same mechanism as an admin grant — removes the risk entirely and requires no
new concept.

## SB-CP-02 — No generic coupon engine in V1

**Status:** Accepted

**Decision:** V1 does not build coupon stacking, a campaign/promotion framework, or per-user dynamic
discount minting as a Razorpay-native concept.

**Rationale:** Explicitly required by this design's source instructions ("keep V1 simple... do not
over-engineer coupons"). [RAZORPAY FACT] There is no documented Razorpay support for combining
multiple Offers on one subscription, and Offer usage limits are instrument-scoped rather than
account-scoped, so a large part of what a "coupon engine" would normally guarantee (per-account
redemption limits) cannot be enforced by Razorpay regardless — it would have to be Kizunia-side
bookkeeping layered on top of a system not designed for it.

## SB-CP-03 — Offers are pre-provisioned from a fixed catalog of discount shapes

**Status:** Accepted

**Decision:** Rather than creating a new Razorpay Offer per promotional code, Kizunia maintains a
small, pre-provisioned catalog of discount *shapes* (e.g. 10% off, 50% off, 99% off first cycle,
flat ₹100 off) in the Razorpay Dashboard, and maps marketing codes onto that fixed catalog.

**Rationale:** [RAZORPAY FACT] Razorpay Offers can only be created from the Dashboard, not via API
(see [`../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../architecture/subscription/provider-boundary/razorpay-facts.md#offers)).
A bounded catalog of shapes, decided once, avoids needing dashboard access as part of any runtime
operation — creating a new marketing code is a mapping-table change, not a Dashboard visit.
