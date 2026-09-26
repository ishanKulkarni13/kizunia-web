# Phase VII — Razorpay TEST Verification Runbook

> **Status:** T0 and O4 verified against Razorpay TEST on 2026-09-26 (UTC), API-only. Every other provider scenario is **UNVERIFIED**; see the [summary matrix](#8-summary-matrix) and [current verification status](#9-current-verification-status).
>
> **Applies to:** the Phase VII trials, Offers and promotions ([phase README](README.md)) · **Tool:** `pnpm billing:promo-verify` (`next/scripts/billing-promo-verify.ts`) · **Mode:** Razorpay **TEST only**

This runbook is how Phase VII's provider behavior is verified against Razorpay TEST. Automated tests run against the fake provider and prove Kizunia's own logic. They never prove what Razorpay does ([testing without Razorpay](../../cross-cutting/testing-without-razorpay.md)). Each scenario below states:

- what to do;
- what Razorpay and Kizunia must then show;
- which evidence to keep.

Write every result into [Razorpay facts](../../provider-boundary/razorpay-facts.md) and into [§9](#9-current-verification-status), **as observed**. Never write a scenario down as verified because the code or a test says it should work.

Promotions involve no provider, so they have no Razorpay scenario: one UI smoke test (P1) is listed for completeness, and everything else about them is covered by the automated suites.

---

## 1. Purpose, scope and safety

- **TEST only.** `billing:promo-verify` refuses to run unless the provider mode resolves to `TEST`. Never put a `rzp_live_` key in `.env` for this runbook.
- **Secrets are never printed.** The script prints IDs, statuses and classes. It never prints a key secret, a webhook secret or a raw payload. Do not paste secrets into evidence.
- **The dev database, never the integration database.** The script and the app use `DATABASE_URL`. `DATABASE_TEST_URL` belongs to the automated suites and is truncated by them.
- **Operations, history and anomalies are audit records.** Never delete `billing_operation`, `subscription_history_entry` or `billing_anomaly` rows to "reset" a scenario. Use a fresh verification user instead ([§6](#6-cleanup-and-reset)).
- **One trial per account.** A trial that reached `TRIALING` consumes the user's eligibility for good, so **each trial scenario needs a fresh customer**. That is the feature working, not a bug in the runbook.
- **Trial length.** Production reads `BILLING_TRIAL_LENGTH_DAYS` (14). `--trial-seconds N` (minimum 60) is a verification override on the script only, for T4 and T5. It is never a configuration value.
- **Each mutating scenario consumes its subscription.** A cancelled TEST subscription cannot be reused.

## 2. Prerequisites and environment

**Software.** Node and pnpm as for the app; `pnpm install` in `next/`; Prisma migrations applied to the dev database (`pnpm prisma migrate deploy`; Phase VII adds three).

**`next/.env` (values never committed):**

| Variable | Value for this runbook |
| --- | --- |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | A TEST pair (`rzp_test_…`) |
| `RAZORPAY_WEBHOOK_SECRET` | The TEST webhook's secret, as registered in the Dashboard |
| `RAZORPAY_ACCOUNT_ID` | The TEST merchant account |
| `BILLING_EXPECTED_MODE` | `test` |
| `DATABASE_URL` | The dev database |
| `BILLING_TRIAL_LENGTH_DAYS` | Leave unset (14). See T4 and T5 for the shortened values |
| `BILLING_TRIAL_CONVERSION_GRACE_SECONDS` | Leave unset (4 days), except T5 |

**Webhooks.** The Phase IV ngrok tunnel is registered in the TEST Dashboard as the webhook URL, with the subscribed events ([IB-20](../../implementation/open-decisions.md#ib-20--a-public-test-webhook-endpoint)). Without it every scenario still converges, through due syncs and `sync`, but the webhook-vs-reconciliation expectations below cannot be observed.

**The app.** Run `pnpm build && pnpm start` or `pnpm dev`, behind the tunnel. Env changes for T5 apply to **both** the app and the script.

**Users (dev database):** a **customer**, one per trial scenario, who signs in and completes checkouts; a `SUPER_ADMIN` (P1).

**A payment method.** A Razorpay TEST card that authenticates, as in the Phase V run. UPI is offered in TEST Checkout since 2026-09-25 but no UPI subscription has been authenticated (IB-18): T7 covers it.

**Opt-in contract suite** (`pnpm test:contract`, never in CI). Phase VII adds:

| Variable | Effect |
| --- | --- |
| `RAZORPAY_CONTRACT_OFFER_ID` | A real TEST Offer's ID (`offer_…`): the suite creates a subscription carrying it and checks the Offer is echoed |

## 3. TEST plan and Offer IDs

**Plans** (the four TEST verification plans, IB-24 item 13; temporary TEST-only prices, not Kizunia pricing):

| Plan · cycle | Razorpay plan ID | Price |
| --- | --- | --- |
| Pro · monthly | `plan_TgDgeZ5thTGEr8` | ₹10 |
| Pro · yearly | `plan_TgDgejlJXhdilW` | ₹12 |
| Pro+ · monthly | `plan_TgDgfArS3b5MQu` | ₹20 |
| Pro+ · yearly | `plan_TgDgfLV0VuYLQz` | ₹22 |

**Offers.** **None exists yet**, and both catalogs (`config/offer-catalog.ts`, TEST and LIVE) ship empty, so every code is refused as unknown. Offers can only be created in the Razorpay Dashboard. To run O1 to O3:

1. In the TEST Dashboard, create an Offer (Subscriptions → Offers): for example a **percentage** discount for a **limited number of cycles (1)**. The chargeable amount after the discount must be more than ₹1 (Razorpay's rule), so 50% off the ₹10 Pro monthly plan is fine.
2. Copy its `offer_id`. Fill this table when you do:

   | Marketing code | Razorpay Offer ID | Discount as configured | Plans and cycles | Eligibility to test |
   | --- | --- | --- | --- | --- |
   | *(to be filled)* | *(to be filled)* | | | |

3. Add an entry to the **TEST** list in `next/src/modules/billing/config/offer-catalog.ts`, and restart the app (this is the V1 flow, [IB-27](../../implementation/open-decisions.md#ib-27--phase-vii-decisions-and-implementation-rulings) item 6: Dashboard → `offer_id` → catalog → deploy):

   ```ts
   TEST: createOfferCatalog([
     {
       marketingCode: "WELCOME50",
       providerOfferId: "offer_xxxxxxxxxxxxxx", // from the Dashboard
       appliesTo: [{ plan: "PRO", cycle: "MONTHLY" }],
       eligibility: "ONCE_PER_USER", // or ANY_USER / FIRST_PAID_SUBSCRIPTION_ONLY
       description: "50% off your first month",
     },
   ]),
   ```

4. Run `RAZORPAY_CONTRACT=1 RAZORPAY_CONTRACT_OFFER_ID=offer_… pnpm test:contract -t "trials and Offers"` to see the Offer echoed on a created subscription.

Do **not** commit a TEST Offer as a LIVE entry: the LIVE list stays empty until a LIVE Offer exists in the LIVE account. TEST and LIVE Offers are different objects.

## 4. Preparing subscriptions

| To reach | How |
| --- | --- |
| A pending trial checkout (`created`) | `pnpm billing:promo-verify trial-start --email E`, then leave it |
| A trial authenticated (`authenticated`, `TRIALING`) | The above, then finish it in Razorpay Checkout at `/user/billing` ("Continue checkout") |
| A pending checkout carrying a code | `offer-start --email E --code C`, then finish it the same way |
| Observing state | `status --email E` (Kizunia's rows and what Razorpay reports), `sync --email E` (a priority-1 sync of the user's open subscription) |

## 5. Scenario catalogue

Tags: **API-TEST** (no browser), **MANUAL-TEST** (needs Razorpay Checkout), **AUTOMATED** (covered by the fake-provider suites only), **UNVERIFIED** (cannot be run yet, or cannot be manufactured in TEST). Every block lists the expected Razorpay state, Kizunia state, entitlement, history and anomaly records, and the evidence to capture.

### Trials

**T0. A trial checkout is created with a future `start_at`, then abandoned** (API-TEST; **verified 2026-09-26**)

- *Preconditions:* none (a fresh verification user is created).
- *Action:* `pnpm billing:promo-verify trial-abandon`.
- *Razorpay:* a subscription `created`, `start_at` = the requested time (now + 14 days), `charge_at == start_at`, `expire_by` kept, period fields null, `paid_count` 0. After the cancel: `cancelled`.
- *Kizunia:* the operation `CREATE_SUBSCRIPTION` `SUCCEEDED` with `request {kind: TRIAL, …}`; the row `kind TRIAL`, `startAt` equal to Razorpay's `start_at`; then `CANCEL_IMMEDIATELY` `SUCCEEDED` and the row `CANCELLED`, `firstContributedAt` null (so the trial is **not** consumed).
- *Entitlement:* FREE throughout.
- *History / anomalies:* `BINDING`, `PHASE PROVISIONING→PENDING_AUTHENTICATION`, `PHASE PENDING_AUTHENTICATION→CANCELLED`. No anomaly.
- *Evidence:* the script output (the stored and Razorpay `start_at` lines).

**T1. A card trial authenticates and becomes `TRIALING`, and the ₹5 authentication charge is refunded** (MANUAL-TEST; **UNVERIFIED**)

- *Preconditions:* a fresh customer with no trial history.
- *Action:*
  1. Sign in as the customer. `/user/billing` must show "Start 14-day free trial" on each plan.
  2. Click it (or run `trial-start --email E`, then "Continue checkout"), and pay with the TEST card.
  3. Watch `/user/billing` until it shows the trial. Then `status --email E`.
- *Razorpay:* the subscription `authenticated`, `paid_count 0`, `start_at` = the stored one, `charge_at == start_at`. In the Dashboard's payments: an authentication charge of **₹5**, captured and then **refunded automatically**. Record the refund's timing (`refund.processed`).
- *Kizunia:* phase `TRIALING`, `kind TRIAL`, `firstContributedAt` set. `/me/billing` shows the trial end date and **no** trial CTA. The `trial.started` event is logged.
- *Entitlement:* the trial plan's access, from authentication.
- *History / anomalies:* `PHASE PENDING_AUTHENTICATION→TRIALING`, trigger `CHECKOUT_CONFIRM` or `WEBHOOK`. No anomaly.
- *Webhook vs reconciliation:* with the tunnel, the `subscription.authenticated` webhook and the confirm call race harmlessly; without it, a due sync applies it.
- *Evidence:* the Dashboard's ₹5 payment and refund, and `status --email E`.

**T2. A second trial is refused, before any Razorpay call** (MANUAL-TEST after T3; **UNVERIFIED**; AUTOMATED)

- *Preconditions:* the T1 customer after T3 (or any user whose trial reached `TRIALING`).
- *Action:* `trial-start --email E`; also try "Start free trial" in the UI (it must not be offered).
- *Razorpay:* nothing new in the Dashboard.
- *Kizunia:* `TRIAL_NOT_ELIGIBLE`; the operation `REJECTED` with `failureClass` null. `allowedActions.trial` is null.
- *Evidence:* the script's refusal line, and the Dashboard subscription list unchanged.

**T3. Cancelling during a trial is immediate, and eligibility stays consumed** (MANUAL-TEST; **UNVERIFIED**)

- *Preconditions:* the T1 customer, `TRIALING`.
- *Action:* Cancel in the UI ("ends now, no further charge"), or `cancel --email E`.
- *Razorpay:* a cycle-end cancel is refused before the first cycle (A1); Kizunia sends the immediate form. The subscription is `cancelled`; nothing is charged.
- *Kizunia:* `CANCEL_IMMEDIATELY` `SUCCEEDED`; phase `CANCELLED`; `trial.cancelled` logged.
- *Entitlement:* FREE at once.
- *Evidence:* `status --email E`; then run T2.

**T4. A trial past `start_at` but inside the grace stays `TRIALING`** (MANUAL-TEST; **UNVERIFIED**)

- *Preconditions:* a fresh customer.
- *Action:* `trial-start --email E --trial-seconds 600`, authenticate at `/user/billing`, wait until `start_at` (10 minutes), then `sync --email E` repeatedly for as long as you care to watch.
- *Razorpay:* observe what it does at `start_at`. On 2026-09-24 it stayed `authenticated` 47 minutes past `start_at` (A7). **Record what you see either way**: if it runs the first charge, that resolves part of A7.
- *Kizunia:* while Razorpay still reports `authenticated`: `TRIALING` (the C7 grace, four days by default), access continues. If Razorpay reports `active`: `ACTIVE`, `trial.converted`. If `pending`: `PAST_DUE`, `trial.first_charge_failed` (a real observation of A7's failure path).
- *Evidence:* the `sync` outputs over time.

**T5. Past `start_at` + grace with no first charge: access stops and the anomaly is raised** (MANUAL-TEST; **UNVERIFIED**)

- *Preconditions:* a fresh customer. **Start the app and the script with `BILLING_TRIAL_CONVERSION_GRACE_SECONDS=120`.**
- *Action:* `trial-start --email E --trial-seconds 600`, authenticate, wait until `start_at` + 2 minutes, then `sync --email E`.
- *Razorpay:* if it still reports `authenticated`: this scenario applies. If it has charged, record that and treat T4 as the result.
- *Kizunia:* phase `PENDING_AUTHENTICATION`; a `TRIAL_CONVERSION_OVERDUE` anomaly (one row; a repeat `sync` bumps `occurrences` and does not alert again); a `billing.alert` with the same condition (MEDIUM). Never auto-resolved.
- *Entitlement:* FREE.
- *History / anomalies:* `PHASE TRIALING→PENDING_AUTHENTICATION`; the anomaly.
- *Evidence:* `status --email E` (the anomaly row) and the alert log line.

**T6. Conversion: the first real charge at `start_at`** (UNVERIFIED; **not manufacturable in TEST**)

TEST mode did not run the scheduled first charge (A7). The Kizunia side (`TRIALING → ACTIVE`, no access gap, `trial.converted`) is covered by `trial-lifecycle.integration`. Watch the first LIVE trial, and record here if T4 or T5 shows Razorpay charging.

**T7. A UPI trial** (MANUAL-TEST once UPI can authenticate; **UNVERIFIED**; A16 (b), IB-18)

- *Preconditions:* UPI offered for Subscriptions in TEST Checkout; a fresh customer.
- *Action:* start a trial (T1) and choose UPI in Checkout.
- *Razorpay:* either the future-`start_at` subscription authenticates (record `payment_method`), or Razorpay refuses the create or the authorization (record the code and description, without matching on the words in code).
- *Kizunia:* the owner's fallback ([IB-27](../../implementation/open-decisions.md#ib-27--phase-vii-decisions-and-implementation-rulings) item 4): trials are offered for every method, and a refusal surfaces to the customer, who can use a card. If UPI cannot authorize a trial, the owner decides whether trials are then offered only to other methods, and records it before trials are launched to UPI users.
- *Evidence:* the Checkout outcome, `status --email E`.

**T8. An upgrade during a trial** (MANUAL-TEST, optional; **UNVERIFIED**)

Needs an owner-approved international-card trial (Razorpay refuses plan updates for other methods, R-06). `change-plan` is the Phase VI command; the trial adds nothing. Downgrades during a trial are refused (AUTOMATED).

### Offers

*Prerequisite for O1 to O3: a Dashboard TEST Offer in the catalog ([§3](#3-test-plan-and-offer-ids)).*

**O1. A checkout with a real Offer** (MANUAL-TEST; **UNVERIFIED**)

- *Preconditions:* the Offer in the TEST catalog; a customer with no subscription (and, for `FIRST_PAID_SUBSCRIPTION_ONLY`, none that ever reached a paid phase).
- *Action:* enter the code at `/user/billing`, or `offer-start --email E --code C`, then complete Checkout.
- *Razorpay:* the create carries `offer_id`; the fetched subscription's `offer_id` equals it; Checkout shows the discounted first charge (record the amount). Record what Razorpay does about the Offer's own limits.
- *Kizunia:* `marketingCode` (normalized) and `offerId` stored; `/me/billing` shows "Code C applied: <description>"; after authentication, `firstContributedAt` set. The provider's Offer ID is in no response.
- *Entitlement:* the plan's access.
- *Evidence:* the Dashboard subscription and payment, `status --email E`.

**O2. `ONCE_PER_USER` is consumed only after authentication** (MANUAL-TEST; **UNVERIFIED**; AUTOMATED)

- *Preconditions:* the catalog entry has `eligibility: "ONCE_PER_USER"`; the O1 customer, after the O1 subscription is cancelled (`cancel` or `cleanup`).
- *Action:* try the same code again at `/user/billing` or with `offer-start`.
- *Kizunia:* `CODE_NOT_ELIGIBLE`; no Razorpay call. A user whose earlier checkout with the code was abandoned before authenticating is **not** refused (O3).

**O3. An abandoned code checkout can be retried** (MANUAL-TEST; **UNVERIFIED**; AUTOMATED)

- *Action:* start a checkout with the code, close Razorpay Checkout without paying, then start again with the same code.
- *Kizunia:* the same pending checkout is handed back while it has time left (no new create), or the old one is abandoned and a new one created; either way the code is still usable, because an abandoned checkout consumed nothing.

**O4. An Offer Razorpay does not know is refused, alerted, and leaves nothing behind** (API-TEST; **verified 2026-09-26**)

- *Action:* `pnpm billing:promo-verify offer-misconfigured`.
- *Razorpay:* `400 BAD_REQUEST_ERROR` "Offer Not Found"; nothing created.
- *Kizunia:* `CODE_REFUSED_BY_PROVIDER` (the customer message has none of the provider's words); the operation `REJECTED` (`failureClass REJECTED`); the subscription `ABANDONED` with no provider ID; a `billing.alert` `OFFER_REJECTED` (HIGH).
- *Evidence:* the script output.

**O5. The discount for its configured cycles, then the full price** (UNVERIFIED; **not manufacturable in TEST**)

The first cycle ends about 30 days out and TEST has no accelerated clock. Watch the first LIVE Offer.

**O6. An Offer across an upgrade or downgrade** (A15, D11; UNVERIFIED)

Needs an owner-approved international-card subscription and an Offer. Kizunia observes and applies whatever results.

### Promotions

**P1. Redeeming a promotion code** (MANUAL-TEST, UI smoke; **not yet run**; fully AUTOMATED)

- *Action:* as `SUPER_ADMIN` create a promotion at `/admin/billing/promotions`; as a customer redeem its code at `/user/billing` ("Redeem a code").
- *Kizunia:* access to the promotion's plan for its duration; a `PROMOTION` grant in `/admin/billing/grants` with no granting administrator; the remaining count down by one; a second redemption is refused. No Razorpay call, and it works with billing disabled.

## 6. Cleanup and reset

- `pnpm billing:promo-verify cleanup --email E` immediately cancels the user's open TEST subscriptions (an admin-kind operation, reason "verification cleanup").
- The `trial-abandon` and `offer-misconfigured` subcommands create and clean up their own throwaway users and subscriptions.
- Do not delete audit rows. A fresh customer is a fresh user; the dev database keeps the history.
- Remove any TEST Offer entry you added to `offer-catalog.ts` only if you do not want to keep the code. It is harmless in the TEST list.
- In the Dashboard, deactivate a TEST Offer you no longer need.

## 7. What TEST cannot produce

| Behavior | Why | Where it is covered |
| --- | --- | --- |
| The first real charge at `start_at`, and its failure (A7) | TEST did not run it 47 minutes past `start_at` | Automated tests; observe the first LIVE trial |
| The discounted cycles ending (O5) | No accelerated clock | Automated tests; observe LIVE |
| A UPI trial (T7) | No UPI subscription authenticated yet (IB-18) | The fallback decision; verify when UPI works |

## 8. Summary matrix

| ID | Scenario | AUTOMATED | API-TEST | MANUAL-TEST | UNVERIFIED |
| --- | --- | --- | --- | --- | --- |
| T0 | Trial create with a future `start_at`, then abandon | yes | **verified** | | |
| T1 | Card trial authenticates, `TRIALING`, ₹5 refund | yes | | needed | yes |
| T2 | Second trial refused | yes | | needed | yes |
| T3 | Cancel during a trial | yes | | needed | yes |
| T4 | Past `start_at`, inside the grace | yes | | needed | yes |
| T5 | Past the grace: anomaly | yes | | needed | yes |
| T6 | Conversion | yes | | not manufacturable | yes |
| T7 | UPI trial | | | blocked (IB-18) | yes |
| T8 | Upgrade during a trial | yes | | optional | yes |
| O1 | A real Offer at checkout | yes | | needed (Offer) | yes |
| O2 | `ONCE_PER_USER` after authentication | yes | | needed (Offer) | yes |
| O3 | Abandoned code checkout, retry | yes | | needed (Offer) | yes |
| O4 | Unknown Offer refused | yes | **verified** | | |
| O5 | Discounted cycles, then full price | yes | | not manufacturable | yes |
| O6 | Offer across an upgrade or downgrade | | | optional | yes |
| P1 | Redeem a promotion (UI smoke) | yes | | not yet run | |

## 9. Current verification status

Append-only; each row dated, and linked to the observation it is based on.

| Date (UTC) | Scenario | Result | Recorded in |
| --- | --- | --- | --- |
| 2026-09-26 | Contract: a create with a future `start_at` and `expire_by` | Accepted; `created`, `start_at` echoed, `charge_at == start_at`, `paid_count` 0 | [Razorpay facts](../../provider-boundary/razorpay-facts.md#phase-vii-trial-and-offer-run-2026-09-26-utc) |
| 2026-09-26 | Contract: an unknown well-formed `offer_id` | `400 BAD_REQUEST_ERROR` "Offer Not Found", classified `REJECTED`, nothing created | same |
| 2026-09-26 | T0 through `billing:promo-verify trial-abandon` | Verified: the stored and Razorpay `start_at` are equal; abandoned to `CANCELLED`; trial not consumed | same |
| 2026-09-26 | O4 through `billing:promo-verify offer-misconfigured` | Verified: `CODE_REFUSED_BY_PROVIDER`, `ABANDONED`, `OFFER_REJECTED` alert, nothing left at Razorpay | same |
| 2026-09-26 | Contract: a real Offer echoed on a subscription | **Not run**: no TEST Offer exists (skipped) | |
