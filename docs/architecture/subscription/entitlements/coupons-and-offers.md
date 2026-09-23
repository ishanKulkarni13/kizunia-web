# Coupons and Offers — Mechanism

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24

Mechanism behind [`../../../project/feature-specification/subscription/coupons-and-promotions.md`](../../../project/feature-specification/subscription/coupons-and-promotions.md).

---

## Offer redemption (billing discount)

```text
User enters a marketing code at checkout
  -> inside the checkout command's precondition step (per-user serialization):
       look up code -> { offerId (pre-provisioned, per provider mode), plans it applies to,
                         eligibility: ANY_USER | FIRST_PAID_SUBSCRIPTION_ONLY | ONCE_PER_USER,
                         validity window }
       evaluate eligibility against the user's own Subscription records (SB-CP-04)
         FIRST_PAID_SUBSCRIPTION_ONLY: no Subscription of this user ever reached
                                       TRIALING, ACTIVE or PAST_DUE
         ONCE_PER_USER:                no Subscription of this user carries this code
       ineligible / expired / wrong plan -> REJECTED before any Razorpay call
  -> createSubscription(..., offer_id)        (commands/checkout-and-creation.md)
  -> the code is stored on the new Subscription
  -> Razorpay applies the discount per the Offer's own configuration
```

The mapping table is Kizunia's own and small. It maps human-friendly codes onto the fixed catalog of
pre-provisioned Offer shapes ([SB-CP-03](../../../project/feature-specification/subscription/decisions/coupons-and-promotions.md#sb-cp-03--offers-are-pre-provisioned-from-a-fixed-catalog-of-discount-shapes)),
separately per provider mode (test and live Offers are different objects).

**Why the eligibility check exists.** **FACT:** Offer limits are per card, not per customer
([razorpay-facts](../provider-boundary/razorpay-facts.md#offers)). Without it, "99% off the first
month" is reusable by cancelling and resubscribing. Three fixed rules evaluated against records
Kizunia already keeps close this without a coupon engine
([SB-CP-04](../../../project/feature-specification/subscription/decisions/coupons-and-promotions.md#sb-cp-04--code-eligibility-is-checked-against-the-users-own-history-and-redemption-is-atomic)).

**Offers after creation.** **FACT:** an Offer can be linked to an active subscription, effective at
cycle end. V1 does not expose this to customers; a Dashboard-linked Offer is observed like any
provider-side change ([SB-CP-05](../../../project/feature-specification/subscription/decisions/coupons-and-promotions.md#sb-cp-05--an-offer-can-be-linked-to-an-active-subscription-effective-at-cycle-end)).

**Offers and plan changes.** **FACT:** with an active Offer, downgrades can only happen at cycle end —
already the only downgrade timing Kizunia uses. Offer behavior across an upgrade is not documented
([A15](../../../project/feature-specification/subscription/open-decisions.md#a-razorpay-behavior-requiring-test-mode-verification-or-support));
the resulting state is observed, not assumed. An Offer does not survive cancellation and resubscription:
a new Subscription carries only the code used for it.

## Promotion redemption (free-access grant)

```text
User enters a promotion code
  -> one transaction:
       look up Promotion { plan, duration, remainingRedemptions, validity window, eligibility }
       INSERT PromotionRedemption(promotionId, userId)          -- unique: second attempt is a no-op
       UPDATE Promotion SET remainingRedemptions = remainingRedemptions - 1
         WHERE id = ? AND remainingRedemptions > 0              -- 0 rows -> sold out, roll back
       INSERT EntitlementGrant { userId, plan, source: PROMOTION,
                                 validFrom: now, validUntil: now + duration, reason: <code> }
       INSERT GrantAuditEntry(created, actor = user, promotion)
  -> effective access includes the plan immediately
```

Identical mechanism to [`admin-grants.md`](admin-grants.md). No Razorpay call happens anywhere in this
path, so it works in every provider mode. Both the unique redemption record and the conditional
decrement are required: the first stops one user redeeming twice from two tabs, the second stops two
users taking the last slot.

## Why redemption limits differ between the two

Offer usage limits are enforced by Razorpay, per payment instrument; Kizunia adds its per-user
eligibility rule on top before calling Razorpay. Promotion limits are entirely Kizunia's, since a
Promotion is a Kizunia-only record.
