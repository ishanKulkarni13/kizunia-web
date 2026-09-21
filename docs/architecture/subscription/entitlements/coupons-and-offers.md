# Coupons and Offers — Mechanism

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

Mechanism behind [`../../../project/feature-specification/subscription/coupons-and-promotions.md`](../../../project/feature-specification/subscription/coupons-and-promotions.md).

---

## Offer redemption (billing discount)

```text
User enters a promo code at checkout
  -> Kizunia looks up the code in its own mapping table: code -> pre-provisioned Razorpay offerId
  -> createSubscription(plan, customer, { offerId })
  -> Razorpay applies the discount per the Offer's own configuration (percentage/flat,
     single-cycle/limited-cycles/forever)
```

The mapping table is Kizunia's own, small, and holds nothing Razorpay needs to know about — it
exists only to let a human-friendly marketing code resolve to one of the pre-provisioned Offer
shapes from [SB-CP-03](../../../project/feature-specification/subscription/decisions/coupons-and-promotions.md#sb-cp-03--offers-are-pre-provisioned-from-a-fixed-catalog-of-discount-shapes).
Kizunia does not track per-user redemption against this table in V1 beyond what Razorpay's own
instrument-scoped `Max Usage`/`Max Usage Per Card` already limits — a Kizunia-account-scoped
redemption limit is not built, consistent with [SB-CP-02](../../../project/feature-specification/subscription/decisions/coupons-and-promotions.md#sb-cp-02--no-generic-coupon-engine-in-v1).

## Promotion redemption (free-access grant)

```text
User enters a promo code
  -> Kizunia looks up the code against its own Promotion definitions (plan, duration, remaining
     redemptions)
  -> an EntitlementGrant is created: { userId, plan, source: PROMOTION, validFrom: now,
                                        validUntil: now + duration, reason: <code> }
  -> effective access includes the granted plan immediately
```

Identical mechanism to [`admin-grants.md`](admin-grants.md) — same entity, same lifecycle, same
audit expectations. No Razorpay call happens anywhere in this path.

## Why redemption limits differ between the two

Offer redemption limits are enforced by Razorpay, per payment instrument — Kizunia cannot make them
account-scoped without its own bookkeeping layered on top (not built in V1). Promotion redemption
limits are enforced entirely by Kizunia, since a Promotion is a Kizunia-only record to begin with —
a per-code "remaining redemptions" counter here is ordinary application logic, not a provider
limitation.
