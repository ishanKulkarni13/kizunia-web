# Open Decisions

> **Status:** Live
>
> **Last Updated:** 2026-09-24 (A1, A2, A5, A8, A13, A14 and parts of A4/A7 answered by TEST verification the same day)

Questions that are **deliberately not answered yet** — either because they are genuinely open
product questions, or because they require observing Razorpay's actual behavior in TEST mode (or
asking Razorpay Support) rather than reading documentation. This is not a backlog; it is a register
of what an implementation phase must resolve before the area it blocks can proceed.

**How to use this document.** Answering an item means writing a ruling in
[`decisions/`](decisions/README.md) (or a FACT in
[`razorpay-facts.md`](../../../architecture/subscription/provider-boundary/razorpay-facts.md)),
updating the document that explains the behavior, and moving the item to
[A-resolved](#a-resolved-answered-by-test-verification-2026-09-24) with the verification date, its
source (official documentation, TEST observation, or both) and its limitations. Resolved items are not
deleted, so the decision history stays readable.

Every item is classified:

| Class | Means |
| --- | --- |
| **TEST** | Resolved by observing Razorpay in TEST mode. An engineering task, not a product decision |
| **SUPPORT** | Resolved only by asking Razorpay (not observable in TEST mode) |
| **PRODUCT** | A genuine product/commercial/legal decision |
| **CONFIG** | An engineering number chosen at implementation time; the *mechanism* is decided, the value is not |

**Until an item is resolved, the design's stated fallback applies** — no item below leaves behavior
undefined.

---

## A. Razorpay behavior requiring TEST-mode verification or Support

Items still open after the 2026-09-24 TEST pass (results of that pass are in
[A-resolved](#a-resolved-answered-by-test-verification-2026-09-24) below and in
[`razorpay-facts.md`](../../../architecture/subscription/provider-boundary/razorpay-facts.md#test-verification-2026-09-24)).
Each row says exactly why it could not be answered.

| # | Item | Class | Why it is still open | Fallback until resolved | Blocks |
| --- | --- | --- | --- | --- | --- |
| A3 | Whether any webhook fires when a `cycle_end` plan change is applied at the cycle boundary | TEST | **Not attempted.** Needs (a) a public HTTPS webhook endpoint registered in the Dashboard (no API exists; no tunnel tool available; skipping webhooks was the decision for the pass) and (b) a successful native plan change, which needs an international-card subscription (excluded) | Due-based sync at the scheduled-change time ([SB-RC-05](decisions/reconciliation.md#sb-rc-05--reconciliation-is-due-based-not-a-sweep)) observes it | Latency of applying a native scheduled downgrade |
| A4 | Exact refusal shape for **UPI** and **e-mandate** subscriptions (the domestic-card refusals are resolved — see A-resolved) | TEST | UPI is not offered in TEST Checkout; an e-mandate registration completed at the mock bank but the subscription stayed `created` for the 9+ minutes observed, so it could never be updated | Any `BAD_REQUEST_ERROR` from an update is classified `REJECTED` (confirmed sufficient for domestic cards) and surfaced as "this plan change isn't available for your payment method" | Deterministic classification in [SB-LC-07](decisions/lifecycle.md#sb-lc-07--razorpay-decides-whether-a-plan-change-is-possible) |
| A6 | Whether `x-razorpay-event-id` is present on every delivery and identical across retries | TEST | **Not attempted** — no webhook endpoint (see A3) | A delivery without the header is deduplicated on `sha256(raw body)` instead | [SB-WH-02](decisions/webhooks-and-reliability.md#sb-wh-02--every-received-event-is-persisted-with-a-unique-constraint-dedupe-key-before-acknowledgement) dedupe key |
| A7 | What happens when a trial's **first real charge at `start_at` fails** (the pre-`start_at` state is resolved — see A-resolved) | TEST | TEST mode never ran the first scheduled charge: the subscription was still `authenticated` 47 minutes after `start_at`, and "Charge this now" is documented only for `active`/`pending` | Presumed the ordinary `pending → halted` path; Kizunia's mapping handles either | [`trials.md`](../../../architecture/subscription/lifecycle/trials.md) |
| A9 | Whether `invoice.*` **webhook events** fire for subscription invoices | TEST | **Not attempted** — no webhook endpoint (see A3). (The invoices themselves are fetchable by API — recorded in `razorpay-facts.md`) | Not subscribed; not needed for lifecycle | Nothing currently |
| A10 | The halted/cancelled behavior of a UPI or e-mandate subscription whose mandate the customer revoked | TEST | **Not reproducible** — TEST mode has no way to revoke a mandate | Whatever state sync reports is mirrored; no assumption is made | Support playbooks |
| A11 | Real-world e-mandate retry timing under Indian banking holidays | TEST | **Not reproducible** — TEST mode has no banking calendar | Kizunia does not depend on the timing — access follows the reported phase | Support expectations only |
| A12 | Kizunia's actual Razorpay API rate limits (none are documented) | SUPPORT | Only Razorpay Support can state them; no 429 was encountered during the TEST pass | Conservative configured budget adapting to observed 429s ([SB-RC-06](decisions/reconciliation.md#sb-rc-06--all-outbound-razorpay-calls-share-one-bounded-request-budget)) | Budget tuning before LIVE |
| A15 | How Razorpay treats an active Offer when a subscription is upgraded | TEST | **Not attempted** — needs a native upgrade (international card, excluded) and an Offer, which can be created only in the Dashboard | Whatever state results is observed and applied; no assumption | Offer + upgrade UX |

### A-resolved. Answered by TEST verification (2026-09-24)

Kept here (not deleted) so the decision history stays readable. Source for every row:
**TEST observation** on 2026-09-24 in Razorpay TEST mode, in addition to the official documentation
named in [`razorpay-facts.md`](../../../architecture/subscription/provider-boundary/razorpay-facts.md).
Limitations are stated per row. Where the observation differs from the documentation, the difference is
flagged in
[`razorpay-facts.md` § Documentation vs observed behavior](../../../architecture/subscription/provider-boundary/razorpay-facts.md#documentation-vs-observed-behavior)
and needs review.

| # | Question | Result | Limitations |
| --- | --- | --- | --- |
| A1 | Can the Cancel API cancel `created`, `pending`, `paused`, `halted`? | **Yes — immediate cancel (`cancel_at_cycle_end: false`) is accepted in all four** (`200`, then `cancelled` on refetch); `halted` observed on two subscriptions. **Cycle-end cancel is not equivalent:** refused (`400`) for `created`/`authenticated`, but `200` **with no state change** for `pending`/`paused`/`halted`. Supersession step 3 therefore works technically ([SB-UQ-04](decisions/uniqueness-and-resubscription.md#sb-uq-04--a-halted-or-paused-subscription-is-superseded-only-by-a-confirmed-cancellation)). **Discrepancy vs documentation (D1, D2) flagged for review** | Card subscriptions only (UPI/e-mandate not reproducible). `pending`/`halted` were reached with Dashboard-simulated failures, not real bank declines. **No webhook observation** (not attempted) |
| A2 | How is a requested cycle-end cancel visible in the fetched entity? | **Not visible.** No field changes; scheduled-change APIs report nothing pending. Only Kizunia's own `BillingOperation` can show "cancels at period end" | Whether the cancel actually *takes effect* at `current_end` was not observable (no accelerated clock) |
| A4 (part) | Refusal shape for domestic-card subscriptions | `400 BAD_REQUEST_ERROR`, four description variants, `field` sometimes `offer_id`; a refused update leaves state unchanged. The current `REJECTED` classification is sufficient | Domestic card only; the remainder is open above |
| A5 | Which timestamp do `from`/`to` filter on? | **`created_at`**, both bounds **inclusive** | Only `created_at` vs `start_at` was contrasted |
| A7 (part) | State until a trial's `start_at` | **`authenticated`**, `paid_count 0`, `charge_at == start_at`, period fields `null`; immediate cancel accepted, cycle-end refused | First-charge failure path is open above |
| A8 | How does `expire_by` interact with `expired` for a `created` subscription without `start_at`? | It becomes **`expired`** after `expire_by`, but only after a lag of up to ~3 minutes (188 s observed). `expire_by` ≥ 30 s ahead accepted; past values rejected | Behavior of a payment made inside the lag window not tested |
| A13 | Maximum `total_count`? | Enforced per period/interval, ≈ 100 years of billing: `monthly` 1200, `yearly` 100 (others in `razorpay-facts.md`) | Values above the maximum are rejected with the maximum named in the message |
| A14 | Does re-sending `cancel_at_cycle_end: true` succeed, error, or change anything? | **Succeeds (`200`), changes nothing observable** | Cannot tell a no-op from a re-record, for the same reason as A2 |

## B. Genuinely open product questions

| # | Open decision | Class | Current V1 behavior | Blocks |
| --- | --- | --- | --- | --- |
| B1 | **Paid-to-paid plan changes for UPI, e-mandate and domestic-card subscriptions.** Razorpay cannot change the plan of these subscriptions ([R-06](decisions/reconciliations.md#r-06--the-update-api-does-not-support-plan-changes-for-most-indian-payment-methods)). Any solution requires a successor-subscription workflow that V1 deliberately does not build | PRODUCT | Unavailable; the user may cancel (keeping access to period end) and subscribe to the new plan once the old subscription has ended — see [SB-LC-07](decisions/lifecycle.md#sb-lc-07--razorpay-decides-whether-a-plan-change-is-possible) | Self-serve upgrades for most Indian customers — **high business impact**, see [`future.md`](future.md#plan-changes-razorpay-cannot-perform-natively) |
| B2 | Whether a long-`halted` subscription should eventually be cancelled by Kizunia (a retention horizon) | PRODUCT | Never cancelled automatically ([SB-PF-03](decisions/payment-failure-and-recovery.md#sb-pf-03--halted-ends-paid-access-but-never-cancels-the-subscription)); sync frequency decays ([SB-PF-05](decisions/payment-failure-and-recovery.md#sb-pf-05--synchronization-of-a-halted-subscription-decays-it-never-stops)) | Nothing technical; affects surprise-recovery risk |
| B3 | Retention period for billing records and raw webhook payloads after account removal (legal/tax) | PRODUCT | Billing records retained and pseudonymized; raw payloads kept 180 days ([SB-DP-04](decisions/data-preservation.md#sb-dp-04--billing-records-survive-account-removal)) | Account-removal implementation |
| B4 | Whether a banned user's paid subscription is cancelled | PRODUCT | Not cancelled automatically; a support action | Moderation playbooks |
| B5 | Whether customers get a self-serve "undo cancellation" | PRODUCT | Not possible natively ([SB-LC-09](decisions/lifecycle.md#sb-lc-09--a-requested-cycle-end-cancellation-cannot-be-undone)); user resubscribes after the period ends | Retention UX |
| B6 | Exact pricing (₹ amounts) per plan/cycle | PRODUCT | — | Nothing architectural |
| B7 | Any trial cooldown or re-trial policy beyond one trial per account | PRODUCT | One trial per account ([SB-LC-11](decisions/lifecycle.md#sb-lc-11--one-trial-per-account)) | [`future.md`](future.md) |
| B8 | Whether MCP access grows beyond a single boolean before other entitlements do | PRODUCT | Single Pro+ boolean | [`future.md`](future.md)'s finer-grained MCP entitlement |
| B9 | The purchase/ownership model for future one-time purchases (e.g. paid themes) | PRODUCT | — | [`future.md`](future.md) |
| B10 | Coupon stacking policy, if ever built | PRODUCT | Not supported | [`future.md`](future.md) |

## C. Implementation-time configuration

Mechanisms are decided; only the values are open. Each is chosen at implementation time, documented
next to the code, and tuned in TEST mode.

| # | Value | Decided mechanism |
| --- | --- | --- |
| C1 | Outbound request budget per window and headroom per priority class | [`provider-rate-limits.md`](../../../architecture/subscription/reconciliation/provider-rate-limits.md) |
| C2 | Sync backoff base, cap and jitter; global cooldown bounds | same |
| C3 | Per-phase heartbeat intervals and checkpoint margins | [`reconciliation-job.md`](../../../architecture/subscription/reconciliation/reconciliation-job.md) |
| C4 | Sync batch size per drain and per `after()` invocation | [`sync-mechanism.md`](../../../architecture/subscription/reconciliation/sync-mechanism.md) |
| C5 | Checkout `expire_by` horizon and `BillingOperation` lease duration | [`checkout-and-creation.md`](../../../architecture/subscription/commands/checkout-and-creation.md) |
| C6 | Tick cadence in each deployment (target 5 min, upper bound 15 min) | [SB-PB-06](decisions/provider-boundary-and-environments.md#sb-pb-06--billing-execution-is-scheduler-agnostic) |

---

## What is *not* open

For clarity, since "not yet decided" and "deliberately decided to be minimal" are easy to confuse:

| Sometimes mistaken for open | Actually decided |
| --- | --- |
| Whether Free requires a Razorpay subscription record | Decided: no — see [SB-EA-01](decisions/effective-access-and-grants.md#sb-ea-01--free-has-no-subscription-record) |
| Whether Kizunia runs its own payment-retry/grace-period engine | Decided: no — see [SB-PF-01](decisions/payment-failure-and-recovery.md#sb-pf-01--no-second-retry-engine) |
| Whether cancellation is immediate by default | Decided: no, cycle-end by default — see [SB-LC-04](decisions/lifecycle.md#sb-lc-04--cancellation-defaults-to-end-of-cycle) |
| Whether downgrading deletes any user data | Decided: never — see [`data-preservation.md`](data-preservation.md) |
| Whether webhook events are trusted to arrive in order | Decided: they are not — see [SB-WH-03](decisions/webhooks-and-reliability.md#sb-wh-03--state-changing-events-trigger-an-authoritative-refetch) |
| Whether a Razorpay Dashboard-initiated change is an edge case | Decided: it is a normal lifecycle path — see [SB-LC-06](decisions/lifecycle.md#sb-lc-06--a-dashboard-originated-change-is-a-normal-lifecycle-path) |
| Whether Kizunia builds a generic multi-provider payment framework | Decided: no — see [SB-PB-01](decisions/provider-boundary-and-environments.md#sb-pb-01--the-provider-boundary-is-sized-not-generic) |
| Whether a user can hold two paid subscriptions | Decided: Kizunia never creates a second open subscription; one arising outside Kizunia is a detected anomaly — see [SB-UQ-02](decisions/uniqueness-and-resubscription.md#sb-uq-02--kizunia-never-creates-a-second-open-subscription-for-a-user) |
| Whether plan changes use a Kizunia-built workaround | Decided: no — native Razorpay capability only — see [SB-LC-07](decisions/lifecycle.md#sb-lc-07--razorpay-decides-whether-a-plan-change-is-possible) |
| Whether Vercel Pro is required | Decided: no — execution is scheduler-agnostic — see [SB-PB-06](decisions/provider-boundary-and-environments.md#sb-pb-06--billing-execution-is-scheduler-agnostic) |
| Whether an Offer can be linked to an active subscription | Decided (FACT): yes, effective at the end of the current cycle — see [SB-CP-05](decisions/coupons-and-promotions.md#sb-cp-05--an-offer-can-be-linked-to-an-active-subscription-effective-at-cycle-end) |
| Whether Razorpay can cancel a `halted`/`paused` subscription (the supersession mechanism) | TEST-OBSERVED 2026-09-24: yes, immediate cancel — see [A-resolved](#a-resolved-answered-by-test-verification-2026-09-24). The design and its `REJECTED` fallback are unchanged |
| The minimum proration difference | FACT: ₹0.5 — see [`razorpay-facts.md`](../../../architecture/subscription/provider-boundary/razorpay-facts.md#upgrade--downgrade) |
| What TEST-mode tooling exists for subscriptions | FACT: Dashboard "Charge this now" simulates success/failure; no send-test-webhook tool — see [`razorpay-facts.md`](../../../architecture/subscription/provider-boundary/razorpay-facts.md#test-vs-live-mode) |
