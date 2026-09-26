# Phase VII — Trials, Offers and Promotions

> **Status:** Implemented 2026-09-26. The code, the UI and the automated tests are complete, and every acceptance criterion holds on the Kizunia side. Four API-level scenarios are verified against Razorpay TEST: two contract cases (a trial create with a future `start_at`, and an unknown Offer refused) and the same two through the real checkout command (T0 and O4). **The phase is not closed:** everything that needs a customer to complete Razorpay Checkout is recorded as open until the owner runs the [TEST runbook](manual-test.md): a card trial reaching `TRIALING` with the ₹5 refund (T1), cancelling and abandoning trials, the conversion grace, and a real Dashboard Offer (O1–O3). Conversion and the first-charge failure cannot be manufactured in TEST (A7), and UPI trials stay PROVIDER-DEPENDENT (IB-18, A16 (b)). Implementation details the documents left open, and the owner's decisions for this phase, are ruled in [IB-27](../../implementation/open-decisions.md#ib-27--phase-vii-decisions-and-implementation-rulings).
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

Ticked means demonstrated on the Kizunia side by automated tests. Where a criterion also names Razorpay behavior, that behavior is stated as open beside it.

- [x] An eligible user can start one trial and gets the trial plan's access from authentication. A second trial is refused. *(A card trial authenticating in Razorpay Checkout, T1, is open; the trial create and its `start_at` are verified against TEST.)*
- [x] A converting trial keeps access through Razorpay's first charge within the grace, and an overdue conversion raises the anomaly. *(TEST never runs the first charge, A7, so conversion is UNVERIFIED at Razorpay.)*
- [x] A valid Offer code applies the configured Offer at creation. An invalid code is refused without a provider call. *(Applying a real Dashboard Offer, O1, is open: none exists yet, and the catalogs ship empty. An Offer Razorpay does not know is verified refused.)*
- [x] A promotion code grants free access for its duration, exactly once per user, and never beyond its redemption limit.
- [x] The trial length (an owner decision) is configured and documented: **14 days**, `BILLING_TRIAL_LENGTH_DAYS`.
- [x] UPI trial support is verified, or recorded as PROVIDER-DEPENDENT together with the owner's fallback decision. *(Recorded as PROVIDER-DEPENDENT with the fallback: offered for every method, a provider refusal surfaces; [IB-27](../../implementation/open-decisions.md#ib-27--phase-vii-decisions-and-implementation-rulings) item 4.)*

## Explicit non-goals

- No-payment-method trials (a Promotion covers that case).
- Repeat trials or cooldowns (B7).
- Coupon stacking (B10).
- Linking an Offer to an active subscription.
- A generic coupon engine.

## Decisions that must already be settled

- **DECIDED:** IB-9, SB-LC-01/10/11, SB-CP-01…05.
- **Owner decision (made 2026-09-26, IB-27 item 1):** the **trial length**, 14 days.
- **PROVIDER-DEPENDENT:** UPI trials (A16 (b)).
- **Open, observe-and-apply:** A7, and A15/D11.

## Risks and blockers

- ~~**Blocker:** the trial length must be decided by the owner before trials are enabled.~~ Decided: 14 days.
- **Provider-dependent:** UPI trials; A7 (the first-charge failure path), which remains a LIVE observation.
- **Risk:** TEST mode does not run the first scheduled charge promptly, so conversion cannot be fully observed in TEST.

## Expected output

The trial flow and eligibility; the IB-9 grace in the mapping; the Offer catalog and code handling; promotions with atomic redemption; migrations; admin promotion tools; tests; TEST records.

## Implementation record

**What was built** (paths relative to `next/src/`)

- **Migrations** (three, the two enum values each in their own `ALTER TYPE`, as the persistence boundary requires): `EntitlementSource.PROMOTION`; `BillingAnomalyType.TRIAL_CONVERSION_OVERDUE`; the `CodeEligibility` enum, `Promotion`, `PromotionRedemption`, `EntitlementGrant.promotionId` and `GrantAuditEntry.promotionId` (both `Restrict`), and the CHECKs:
  - the counter is never negative;
  - the duration is positive and the window ends after it starts;
  - a code is stored normalized;
  - a `PROMOTION` grant names its promotion, and an admin grant never does.

  `prisma migrate diff` against the migrated database is empty.
- **Trials, through the one checkout.** There is no trial flow.
  - `StartCheckoutSchema` gains `trial` and `code`, and nothing else. `.strict()` still refuses every field that would let a client decide a price, a discount, eligibility, an Offer identifier or a start time.
  - `policy/command-preconditions.ts` evaluates the trial and code rules after the open-subscription table, whose refusals win. The same-intent rule is now plan, cycle, kind and code.
  - `policy/trial-eligibility.ts`, `policy/code-eligibility.ts` and `policy/trial-funnel.ts` are pure. `backend/commands/billing-history.ts` reads the user's own Subscription rows in one query, inside the per-user slot.
  - `backend/commands/acquisition.ts` turns the request into the intent, the history and the fields `createProvisioning` records. The trial's `start_at` (now + 14 days) is computed once, written on the `PROVISIONING` record, and read back by the create step, so what is sent is what was recorded.
  - `StartCheckout` and `Supersede` share all of it.
- **Offers.** `config/offer-catalog.ts` is the static, per-mode catalog (code, Offer ID, plans and cycles, eligibility, window, description), empty in both modes. `backend/offers/offer-code-source.ts` is the narrow asynchronous port every consumer reads it through; the provider's Offer is an opaque reference nothing between the catalog and the create step interprets. A provider-refused create that carried an Offer is `CODE_REFUSED_BY_PROVIDER` with an `OFFER_REJECTED` alert.
- **The apply path** raises `TRIAL_CONVERSION_OVERDUE` beside the alert, once per subscription (occurrences bump, no repeated alert), never auto-resolved, and logs the trial funnel (`trial.checkout_started`, `trial.started`, `trial.converted`, `trial.first_charge_failed`, `trial.cancelled`, `trial.ended`).
- **Promotions.** `backend/grants/promotion.{service,repository,mapper,dto}.ts`. Redemption is one transaction: the conditional decrement, the grant, the redemption and the audit entry commit together or not at all. Create and list are authorized by `MANAGE_ENTITLEMENT_GRANTS`. Routes: `POST /api/v1/me/billing/promotions/redeem`, `GET|POST /api/v1/admin/billing/promotions`. Rate limit `promotions:redeem` (10 per 10 minutes, per user, fails closed).
- **`/me/billing`** adds `allowedActions.trial` (the server's eligibility flag and the length), `subscription.kind`, `trialEndsAt` and `offer` (the code and the catalog's description), and `resumeCheckout` now states the intent a pending checkout was created with. No provider identifier.
- **UI:** the trial CTA (only when `allowedActions.trial` says so), a code field, trial and applied-code lines, a redeem-a-code card that works in every provider mode, and the admin promotions page (`/admin/billing/promotions`, in the sidebar).
- **Test seams and tools:** the opt-in contract cases for a future `start_at` and an unknown Offer (and a real Offer when `RAZORPAY_CONTRACT_OFFER_ID` is supplied), `pnpm billing:promo-verify`, and the [TEST runbook](manual-test.md).

**Implementation decisions** (the lasting ones are IB-27)

- **The Offer catalog is static in V1, deliberately (IB-27 item 6).** Adding an Offer is a code change and a deployment. It sits behind `OfferCodeSource` so that a later admin-managed, database-backed catalog replaces only the source. That future admin Offer UI and catalog are **not** built here and belong to Phase VIII or later.
- **`FIRST_PAID_SUBSCRIPTION_ONLY` reads Subscription rows only** (IB-27 item 9). A user whose only paid access came from an admin grant or a promotion is still eligible. A mutation check that makes the history count grants fails a test.
- **One authorization chain for promotions** (IB-27 item 16), and **one transaction for redemption** (item 15).

**Deviations from the documentation**

- **An Offer's terms are text, not numbers.** The plan sketched a `terms` object (kind, value, cycles). The catalog carries only a `description`: the discount is the Razorpay Offer's own configuration, and a duplicated number could drift from it and read as authoritative.
- **The "code on a trial" refusal lives in the policy, not the schema.** One place for the rule, and it is recorded and replayable like any other refusal.
- **Promotion redemption inserts the grant before the redemption record** (the record references the grant), after the conditional decrement. The documented pseudo-code lists the redemption first; the invariants are the same.
- **The promotion redemption screen is a card on the billing page**, not a page of its own.
- **Promotions can be created and listed, not edited or deactivated.** The phase scope names creation and listing only.
- **The grant audit entries for extending or revoking a `PROMOTION` grant carry its `promotionId`.** Not in the plan; it keeps the audit trail traceable to the promotion.

**Verification**

- **Unit tests:** 1,372 after Phase VI, 1,447 now, all passing. New: code and trial eligibility, the acquisition rules of the precondition policy, the trial funnel, the offer catalog invariants, and the checkout and promotion schemas (including every tamper case), and the fake provider's trial and Offer creation.
- **Integration tests:** 821 after Phase VI, 954 now. The new suites are:
  - `checkout-acquisition.integration` (53: trial and code checkouts, concurrency, replay, provider refusal and unknown outcome, reuse and abandonment);
  - `trial-lifecycle.integration` (14: TRIALING, the conversion grace at its exact edges, the anomaly, conversion, first-charge failure, cancelling and changing plan during a trial, and stale and racing observations);
  - `promotion.service.integration` (34: atomic redemption, the same-user race, the last-slot race, sold-out, expiry by clock, the maximum across sources, the database CHECKs, and the authorization chain);
  - `promotion.controller.integration` (17: 401, 403, 422, 409, the tamper cases and the rate limit);
  - `billing-summary.acquisition.integration` (9);
  - and six new cases in `billing-checkout.controller.integration`.
- **Mutation checks.** Each made at least one test fail (the failing tests are named in the run output, not counted here), and each was reverted byte-for-byte:

  | | Mutation |
  | --- | --- |
  | M1 | trial eligibility always true |
  | M2 | an abandoned trial checkout counts as consumed |
  | M3 | `ONCE_PER_USER` ignores history |
  | M4 | `FIRST_PAID_SUBSCRIPTION_ONLY` counts grants |
  | M5 | a code's window is not checked |
  | M6 | a code's plan and cycle are not checked |
  | M7 | a code is allowed on a trial |
  | M8 | the overdue anomaly is not raised |
  | M9 | the grace edge is off by one |
  | P1 | the decrement is unconditional |
  | P2 | the duplicate-redemption error is not mapped |
  | P3 | the decrement runs outside the transaction |
  | P4 | the create and the list authorization checks removed (separately) |
  | P5 | the promotion window is not checked |
  | P6 | the redeem rate limit removed |
  | P7 | promotion eligibility skipped |
  | P8 | the redeemer is taken from the request, not the session |

- **Build and lint:**
  - `tsc` is clean (source, tests and scripts);
  - `next build` succeeds, with `/admin/billing/promotions`, `/api/v1/admin/billing/promotions` and `/api/v1/me/billing/promotions/redeem`;
  - `eslint` reports nothing in any file this phase touched.
- **Against Razorpay TEST (2026-09-26 UTC).** Details are in [the run](../../provider-boundary/razorpay-facts.md#phase-vii-trial-and-offer-run-2026-09-26-utc):
  - a create with a future `start_at` (14 days) alongside `expire_by` is accepted; the subscription is `created`, `start_at` is echoed, `charge_at == start_at`, the period fields are null and `paid_count` is 0 (contract suite, and through the real checkout command as T0);
  - an unknown well-formed `offer_id` is `400 BAD_REQUEST_ERROR` and creates nothing, classified `REJECTED`, and through the command it is `CODE_REFUSED_BY_PROVIDER` with the record `ABANDONED` and an `OFFER_REJECTED` alert (O4).

**Known issues, not caused by this phase**

- `delivery.integration.test.ts` › "skips a push that is no longer worth sending" fails: its fixed clock (`2026-09-17`) no longer holds. It is the failure recorded since Phase V.
- `asset-admin.integration.test.ts` › "paginates" is an intermittent failure (passes on a re-run).
- `postgres.store.integration.test.ts` › "admits exactly the ceiling under concurrency" fails intermittently on its own (1 in 8 isolated runs), with no billing code involved.
- **One failure of the new redeem rate-limit test** occurred once in five full integration runs and did not reproduce in twelve isolated runs or three further billing-suite runs. It may belong to the same rate-limit store flake; it was not diagnosed. It is recorded, not dismissed.

### Open items

- **Card TEST runs (this phase's provider work)** need a customer's authenticated card subscription, which only the owner can create (hCaptcha). Each is scripted in [the runbook](manual-test.md), and none may be recorded as verified until it is run:
  - T1, a card trial reaching `authenticated`, then `TRIALING`, with the ₹5 authentication refund observed;
  - T2 to T5, a second trial refused, cancelling during a trial, a short trial inside the grace, and past it;
  - O1 to O3, a checkout with a real Dashboard TEST Offer, and `ONCE_PER_USER` after authentication. **These need an Offer created in the TEST Dashboard**, which the owner will add later.
- **Not manufacturable in TEST:**
  - conversion, the first real charge at `start_at` (A7: `authenticated` stayed 47 minutes past `start_at`);
  - the first-charge failure path, presumed to be `pending → halted` and unverified;
  - the ₹5 refund's timing. Automated tests cover the Kizunia side; LIVE is where these are observed.
- **UPI trials** (IB-18, A16 (b)): whether UPI AutoPay can authorize a future-`start_at` subscription is unverified. The fallback is recorded (IB-27 item 4); the decision is revisited after a UPI TEST run, and a UPI launch stays blocked.
- **An Offer with a trial** is refused in V1 (IB-27 item 3). Whether they can combine at Razorpay is unverified.
- **An Offer across an upgrade or downgrade** (A15, D11) stays observe-and-apply and unverified.
- **Whether a `created` trial with a `start_at` expires at `expire_by`** (as a non-trial does, A8) was not observed.
- **A database-backed, admin-managed Offer catalog and its admin UI** are future work (IB-27 item 6).
- **Editing or deactivating a promotion** is not built.

**Commits**

In order:

1. the owner decisions and the IB-27 rulings
2. the migrations and schema
3. trials and Offer codes through the existing checkout, the apply path and the summary
4. promotion redemption and the admin promotion routes
5. the trial CTA, code entry, redemption card and admin promotions page
6. the TEST contract cases and the verification script
7. the runbook, this record and the status updates
8. the fake provider's trial and Offer creation cases, with the final counts in this record

