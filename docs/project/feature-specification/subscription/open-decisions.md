# Open Decisions

> **Status:** Live
>
> **Last Updated:** 2026-09-24

Questions that are **deliberately not answered yet** — either because they are genuinely open
product questions, or because they require observing Razorpay's actual behavior in TEST mode (or
asking Razorpay Support) rather than reading documentation. This is not a backlog; it is a register
of what an implementation phase must resolve before the area it blocks can proceed.

**How to use this document.** Answering an item means writing a ruling in
[`decisions/`](decisions/README.md) (or a FACT in
[`razorpay-facts.md`](../../../architecture/subscription/provider-boundary/razorpay-facts.md)),
updating the document that explains the behavior, and **deleting the item from here**.

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

| # | Item | Class | Fallback until resolved | Blocks |
| --- | --- | --- | --- | --- |
| A1 | Whether `halted`, `paused`, `pending` and `created` subscriptions can be cancelled via the Cancel API (docs name only `active`/`authenticated`) | TEST | `halted`/`paused` refused → supersession is refused and the user is directed to recover the existing subscription ([SB-UQ-04](decisions/uniqueness-and-resubscription.md#sb-uq-04--a-halted-or-paused-subscription-is-superseded-only-by-a-confirmed-cancellation)). `pending` refused → a `PAST_DUE` customer's cancellation is shown as unavailable until the payment recovers or halts. `created` refused → an unfinished checkout for a different plan blocks a new checkout until its short `expire_by` passes; the user can continue the existing one meanwhile | [`multiple-subscriptions.md`](../../../architecture/subscription/lifecycle/multiple-subscriptions.md#supersession); cancellation while past due; abandoned-checkout cleanup |
| A2 | How a requested-but-not-yet-effective cycle-end cancellation appears in the fetched entity (no field is documented) | TEST | Kizunia's own `BillingOperation` record is the only source of "cancels at period end"; Dashboard/UPI-originated cycle-end cancellations are invisible until they take effect | "Your plan ends on…" UI accuracy for non-Kizunia-originated cancellations |
| A3 | Whether any webhook fires when a `cycle_end` plan change is applied at the cycle boundary | TEST | Due-based sync at the scheduled-change time ([SB-RC-05](decisions/reconciliation.md#sb-rc-05--reconciliation-is-due-based-not-a-sweep)) observes it | Latency of applying a native scheduled downgrade |
| A4 | Exact error codes/shape Razorpay returns when refusing an update for UPI, e-mandate or domestic-card subscriptions | TEST | Any `BAD_REQUEST_ERROR` from an update is classified `REJECTED` and surfaced as "this plan change isn't available for your payment method" | Deterministic classification in [SB-LC-07](decisions/lifecycle.md#sb-lc-07--razorpay-decides-whether-a-plan-change-is-possible) |
| A5 | Which timestamp Fetch All Subscriptions' `from`/`to` filter on (presumed `created_at`) | TEST | Orphan-discovery windows overlap generously (see [`orphan-discovery.md`](../../../architecture/subscription/reconciliation/orphan-discovery.md)) | Orphan-discovery window sizing |
| A6 | Whether `x-razorpay-event-id` is present on every delivery and identical across retries | TEST | A delivery without the header is deduplicated on `sha256(raw body)` instead | [SB-WH-02](decisions/webhooks-and-reliability.md#sb-wh-02--every-received-event-is-persisted-with-a-unique-constraint-dedupe-key-before-acknowledgement) dedupe key |
| A7 | Subscription state until a trial's `start_at`, and the path when the first real charge at `start_at` fails | TEST | Presumed `authenticated`, then the ordinary `pending → halted` path; Kizunia's mapping handles either | [`trials.md`](../../../architecture/subscription/lifecycle/trials.md) |
| A8 | How `expire_by` interacts with `expired` for a `created` subscription without `start_at` | TEST | Kizunia sets `expire_by` explicitly on every create and also treats a local checkout older than it as abandoned | Abandoned-checkout cleanup timing |
| A9 | Whether `invoice.*` webhooks fire for subscription invoices | TEST | Not subscribed; not needed for lifecycle | Nothing currently |
| A10 | The halted/cancelled behavior of a UPI or e-mandate subscription whose mandate the customer revoked | TEST | Whatever state sync reports is mirrored; no assumption is made | Support playbooks |
| A11 | Real-world e-mandate retry timing under Indian banking holidays | TEST | Kizunia does not depend on the timing — access follows the reported phase | Support expectations only |
| A12 | Kizunia's actual Razorpay API rate limits (none are documented) | SUPPORT | Conservative configured budget adapting to observed 429s ([SB-RC-06](decisions/reconciliation.md#sb-rc-06--all-outbound-razorpay-calls-share-one-bounded-request-budget)) | Budget tuning before LIVE |
| A13 | The maximum `total_count` Razorpay accepts per billing interval | TEST | A conservative configured value; a `completed` subscription is handled as terminal | Choice of `total_count` at creation |
| A14 | Whether re-sending `cancel_at_cycle_end: true` for a subscription already scheduled to cancel succeeds, errors, or changes anything | TEST | Treated as possibly erroring: an error on re-issue is shown as "already cancelling" when Kizunia's own record says so | Resolving outcome-unknown cycle-end cancellations |
| A15 | How Razorpay treats an active Offer when a subscription is upgraded | TEST | Whatever state results is observed and applied; no assumption | Offer + upgrade UX |

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
| The minimum proration difference | FACT: ₹0.5 — see [`razorpay-facts.md`](../../../architecture/subscription/provider-boundary/razorpay-facts.md#upgrade--downgrade) |
| What TEST-mode tooling exists for subscriptions | FACT: Dashboard "Charge this now" simulates success/failure; no send-test-webhook tool — see [`razorpay-facts.md`](../../../architecture/subscription/provider-boundary/razorpay-facts.md#test-vs-live-mode) |
