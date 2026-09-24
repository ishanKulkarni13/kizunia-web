# Coupons and Promotions

> **Status:** Stable
>
> **Last Updated:** 2026-09-24

V1 is deliberately small. There is no generic coupon engine, no code stacking, no per-user dynamic
discount minting. Two mechanisms cover everything V1 needs to support, and they are not
interchangeable.

---

## Two mechanisms, two purposes

| | Answers | Ever touches Razorpay? |
| --- | --- | --- |
| **Offer** | "Is this real, ongoing paid subscription discounted?" | Yes — it is a Razorpay billing construct |
| **Promotion** | "Does this user get free plan-level access for a while?" | No — it is an admin-grant-shaped Kizunia record |

A "99% off your first month" code is an **Offer**: the user still has a real Razorpay subscription,
just billed less for a period. A "free Pro for 30 days, no card required" code is a **Promotion**:
there is no Razorpay subscription at all until the user chooses to actually subscribe later.
Collapsing these into one concept was the single biggest risk the earlier feasibility research
flagged — Razorpay has no concept of "grant this Kizunia account free access," and trying to model
one as a Razorpay discount would mean either a real ₹0 subscription (unnecessary Razorpay
dependency for something that isn't billing at all) or misusing Offer semantics Razorpay wasn't
designed for.

## What Offers support in V1

- Percentage or flat discount
- Applied for one billing cycle, a limited number of cycles, or the life of the subscription
- Eligibility per code: anyone, first paid subscription only, or once per user — checked against the
  user's own history, so a "first month" discount cannot be reused by cancelling and resubscribing
- Attached at subscription creation time, from a small pre-provisioned catalog of discount shapes
  (Razorpay Offers can only be created from the Razorpay Dashboard, not via API — see
  [`../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../architecture/subscription/provider-boundary/razorpay-facts.md))

## What Promotions support in V1

- Free access to a specific plan for a specific duration, redeemed via a code
- A code can be redeemed at most once per user, and never beyond its redemption limit — even from two
  tabs at once
- Otherwise identical in mechanism and audit expectations to an [admin grant](admin-grants.md)

## What is explicitly not being built in V1

| Not built | Why |
| --- | --- |
| Coupon stacking | No evidence Razorpay supports it; no product need identified yet |
| Per-user dynamic discount codes as a Razorpay-native concept | Razorpay Offers are instrument-scoped, not Kizunia-account-scoped — see [`../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../architecture/subscription/provider-boundary/razorpay-facts.md) |
| A generic, extensible coupon/campaign engine | Not required by any current product need; would be speculative infrastructure |
| Applying a discount to an existing subscription (self-serve) | Razorpay supports it only from the next billing cycle; not needed in V1. Support can do it from the Razorpay Dashboard — see [SB-CP-05](decisions/coupons-and-promotions.md#sb-cp-05--an-offer-can-be-linked-to-an-active-subscription-effective-at-cycle-end) |

See [`future.md`](future.md) for what a later phase might add.

## Related rulings

[`decisions/coupons-and-promotions.md`](decisions/coupons-and-promotions.md).
