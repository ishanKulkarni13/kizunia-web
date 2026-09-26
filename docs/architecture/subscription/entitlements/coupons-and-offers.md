# Coupons and Offers — Mechanism

> **Status:** Implemented in Phase VII (2026-09-26): Offer codes through the existing checkout (`policy/code-eligibility.ts`, `backend/offers/offer-code-source.ts`, `config/offer-catalog.ts`), and promotions as grants (`backend/grants/promotion.service.ts`). Applying a real Dashboard Offer is not yet verified against Razorpay TEST; see [the Phase VII runbook](../implementation-plan/phase-VII/manual-test.md).
>
> **Last Updated:** 2026-09-26

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

**Rulings that shape it (Phase VII, [IB-27](../implementation/open-decisions.md#ib-27--phase-vii-decisions-and-implementation-rulings)):**

- A code is consumed only by a subscription that carried it **and reached a contributing phase** (`firstContributedAt`). An abandoned or expired checkout consumes nothing (owner decision).
- `FIRST_PAID_SUBSCRIPTION_ONLY` reads Subscription rows only. Admin grants, promotion grants and effective access are never consulted, so a user whose only paid access came from a grant or a promotion is still eligible.
- All eligibility is read from the user's Subscriptions in the current provider mode only.
- A code with a trial checkout is refused before any provider call.
- An invalid code is one answer: unknown, outside its window, and not sold in this mode are not told apart.
- A create refused by the provider while an Offer was sent is `CODE_REFUSED_BY_PROVIDER` with an `OFFER_REJECTED` alert (a misconfigured Offer); no provider description is parsed.

**V1 provisioning is static, and that is intentional (owner decision, IB-27 item 6).** The flow is
Razorpay Dashboard → `offer_id` → an entry in `config/offer-catalog.ts` → deploy → the code works. Adding an
Offer is a code change and a deployment. Every consumer reads the catalog through one narrow asynchronous
port (`OfferCodeSource`), and the provider's Offer is an opaque reference carried from the catalog to the create
step, so a later admin-managed catalog (an admin copies the `offer_id` and its metadata into a Kizunia
dashboard, stored in the database, no deploy) replaces the source only: the eligibility rules, the checkout,
the redemption and the entitlement code are unchanged. That admin UI and catalog are **not built in
Phase VII** (Phase VIII or later), and Kizunia does not compute the discount: the Offer's own configuration at
Razorpay does, and the catalog carries only a description for display.

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
path, so it works in every provider mode. **As built:** the conditional decrement, the grant, the redemption
record and the audit entry commit in **one** transaction or not at all; a duplicate, a sold-out promotion, an
ineligible user or any error rolls all of it back (the redemption record references the grant, so the grant is
inserted first). `MANAGE_ENTITLEMENT_GRANTS` (`SUPER_ADMIN`) is the one permission for creating and listing
promotions, enforced in the service; redeeming needs only a session, and the redeemer is always the session user.
Promotion codes and Offer codes are disjoint. Both the unique redemption record and the conditional
decrement are required: the first stops one user redeeming twice from two tabs, the second stops two
users taking the last slot.

## Why redemption limits differ between the two

Offer usage limits are enforced by Razorpay, per payment instrument; Kizunia adds its per-user
eligibility rule on top before calling Razorpay. Promotion limits are entirely Kizunia's, since a
Promotion is a Kizunia-only record.
