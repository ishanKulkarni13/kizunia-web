# Phase VII — Trials, Offers and Promotions

> **Status:** Not started
>
> **Depends on:** Phase V (and Phase I for grants) · **Razorpay needed:** TEST (card; UPI once enabled) · **Old slices:** S13, S14

## Objective

Add the three acquisition mechanisms V1 decided on:

- **Razorpay-native trials**, one per account;
- **Offers** for real discounts, through pre-provisioned Razorpay Offers and marketing codes;
- **Promotions** for free access, as time-limited grants.

All three reuse existing machinery: checkout for trials and Offers, grants for Promotions.

## Scope

- **Trials** ([trials](../../lifecycle/trials.md)):
  - `kind = TRIAL` at checkout with `start_at` = the trial end;
  - eligibility (no prior `TRIAL` subscription ever reached `TRIALING`), checked under the per-user command slot (SB-LC-11);
  - immediate cancel during the trial (built in Phase VI);
  - the **bounded conversion** rule, with grace C7 and a `TRIAL_CONVERSION_OVERDUE` anomaly ([IB-9](../../implementation/open-decisions.md#ib-9--trial-conversion-gap)).
- **Offers** ([coupons and offers](../../entitlements/coupons-and-offers.md)):
  - a per-mode catalog mapping marketing code → Offer ID (`config/offer-catalog.ts`);
  - Kizunia-side code eligibility checked against the user's own history;
  - `offer_id` passed at creation;
  - nothing linked after creation in V1.
- **Promotions** ([coupons and offers](../../entitlements/coupons-and-offers.md#promotion-redemption-free-access-grant)):
  - `Promotion` and `PromotionRedemption`;
  - redemption creates an `EntitlementGrant(source = PROMOTION)` atomically;
  - one redemption per user per promotion, and a conditional decrement of remaining redemptions.
- Admin creation and listing of promotions (`MANAGE_ENTITLEMENT_GRANTS`).

## Architectural components involved

Phase V checkout and preconditions; Phase IV mapping (the IB-9 rule); Phase I grants and resolver; `modules/billing/backend/grants/promotion.service.ts`; `modules/billing/config/offer-catalog.ts`.

## Dependencies

Phase V (checkout) and Phase I (grants). Phase VI is not required, but trial cancellation uses its cancel command, so ship VI first or together.

## Files and modules likely affected

Paths are relative to `next/src/`.

- `modules/billing/policy/{trial-eligibility,state-mapping}.ts`, `backend/commands/start-checkout.ts`.
- `modules/billing/config/offer-catalog.ts`.
- `modules/billing/backend/grants/promotion.service.ts`.
- `app/api/v1/me/billing/promotions/redeem/route.ts`, admin promotion routes and UI.
- `lib/rate-limit/policies.ts`: `promotions:redeem`.
- `prisma/schema.prisma` and migrations.

## Database and schema work

Per the [persistence boundary](../README.md#persistence-boundary):

- `EntitlementSource.PROMOTION` and `BillingAnomalyType.TRIAL_CONVERSION_OVERDUE`, **each in its own** `ALTER TYPE … ADD VALUE` migration;
- the models `Promotion` and `PromotionRedemption` (with `@@unique([promotionId, userId])`, the `remainingRedemptions >= 0` CHECK, and a nullable `userId` with `Restrict` plus `subjectPseudonym`);
- the columns `EntitlementGrant.promotionId` and `GrantAuditEntry.promotionId`, with `Restrict` FKs;
- the CHECK `source <> 'PROMOTION' OR "promotionId" IS NOT NULL`.

## Domain and application work

- Trial eligibility is derived from Subscription records, not a new table. An abandoned trial checkout does not consume it; a cancelled, converted or failed trial does.
- Conversion needs no dedicated handler. The IB-9 grace keeps a converting user's access, then stops, and raises the anomaly when Razorpay has not reported a charge by `start_at + C7`.
- The first post-trial charge failing (A7) is presumed to follow the ordinary `pending → halted` path. The mapping handles either outcome.
- A marketing code is either an Offer code or a Promotion code, never both (SB-CP-01). An invalid or ineligible code is refused before any provider call.
- Promotion redemption: one transaction for the redemption, the grant and its audit, and the conditional decrement. A `P2002` on `(promotionId, userId)` means "already redeemed".

## Provider work

- TEST: a card trial reaching `authenticated`, then `TRIALING`, with the ₹5 authentication refund observed; a checkout with a Dashboard-created TEST Offer.
- **UPI trials: PROVIDER-DEPENDENT.** Whether UPI AutoPay can authorize a future-`start_at` subscription is unverified ([A16](../../../../project/feature-specification/subscription/open-decisions.md#a-razorpay-behavior-requiring-test-mode-verification-or-support) (b)). If it turns out to be unsupported, the owner decides whether trials are offered only to other methods. That decision is recorded before trials are launched to UPI users.
- A15/D11 (Offers across upgrades and downgrades) stays observe-and-apply.

## Integration work

- A trial CTA shown only when the user is eligible (a server flag).
- Code entry at checkout.
- A promotion redemption screen.
- Admin promotion management.

## Authorization and entitlement implications

- Promotions produce grants, so they flow through the same resolver and are audited like admin grants. `grantedByUserId` is null for `PROMOTION`, which the CHECK allows.
- Creating promotions requires `MANAGE_ENTITLEMENT_GRANTS` (`SUPER_ADMIN`).

## Concurrency and transaction considerations

- Trial eligibility is checked inside the per-user root slot, so two tabs cannot both start a trial.
- The last promotion slot: a conditional decrement (`WHERE remainingRedemptions > 0`) plus the unique constraint, so exactly one redemption wins.

## Observability requirements

- `grant.created` with source `PROMOTION`.
- Trial funnel events.
- `billing.alert TRIAL_CONVERSION_OVERDUE`.

## Testing requirements

**Unit:** trial eligibility cases; the IB-9 mapping at the grace edges; code classification.

**Integration:**
- two concurrent trial starts → one;
- promotion double-redeem and a last-slot race;
- an expired promotion is refused;
- a promotion grant expires by clock and access falls back.

**Provider-TEST:** a card trial and an Offer checkout. UPI trial once IB-18 allows.

## Acceptance criteria

- [ ] An eligible user can start one trial and gets the trial plan's access from authentication. A second trial is refused.
- [ ] A converting trial keeps access through Razorpay's first charge within the grace, and an overdue conversion raises the anomaly.
- [ ] A valid Offer code applies the configured Offer at creation. An invalid code is refused without a provider call.
- [ ] A promotion code grants free access for its duration, exactly once per user, and never beyond its redemption limit.
- [ ] The trial length (an owner decision) is configured and documented.
- [ ] UPI trial support is verified, or recorded as PROVIDER-DEPENDENT together with the owner's fallback decision.

## Explicit non-goals

- No-payment-method trials (a Promotion covers that case).
- Repeat trials or cooldowns (B7).
- Coupon stacking (B10).
- Linking an Offer to an active subscription.
- A generic coupon engine.

## Decisions that must already be settled

- **DECIDED:** IB-9, SB-LC-01/10/11, SB-CP-01…05.
- **Owner decision needed before this phase:** the **trial length**.
- **PROVIDER-DEPENDENT:** UPI trials (A16 (b)).
- **Open, observe-and-apply:** A7, and A15/D11.

## Risks and blockers

- **Blocker:** the trial length must be decided by the owner before trials are enabled.
- **Provider-dependent:** UPI trials; A7 (the first-charge failure path), which remains a LIVE observation.
- **Risk:** TEST mode does not run the first scheduled charge promptly, so conversion cannot be fully observed in TEST.

## Expected output

The trial flow and eligibility; the IB-9 grace in the mapping; the Offer catalog and code handling; promotions with atomic redemption; migrations; admin promotion tools; tests; TEST records.
