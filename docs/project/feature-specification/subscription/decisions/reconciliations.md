# Reconciliations

> **Status:** Live
>
> **Last Updated:** 2026-09-24

Genuine contradictions or clarifications between the source material are recorded here with their
resolution, rather than silently applied. This mirrors the notification subsystem's own
`reconciliations.md`.

---

## R-01 — The 7-day grace period is superseded by Razorpay-anchored recovery

**Source conflict:** `suscriptions.md` §23 proposed a "7-day configurable payment grace period" as
an initial product requirement, with the exact entitlements during that period left explicitly
open (§24).

**Reconciling direction:** This design's source instructions state plainly: "we intentionally do
not want to create a second payment-retry system... if Razorpay can handle the recovery/grace
behavior naturally, let Razorpay handle it."

**Resolution:** The 7-day figure is not carried forward as a Kizunia-owned timer. Instead,
Razorpay's own retry window (`pending`, roughly three to four days for cards/UPI) is treated as the
grace period, and `halted` is the point access ends — see
[`payment-failure-and-recovery.md`](payment-failure-and-recovery.md). This is a genuine change in
mechanism from the original document, not merely a clarification, and is recorded here for that
reason.

## R-02 — Coupon-granted "free plan for N days" is not a Razorpay concept

**Source conflict:** `suscriptions.md` §19 described a coupon like `FREEPRO30` granting "Pro access
for 30 days" as one flavor of coupon, alongside percentage/fixed billing discounts, without
distinguishing the two as different mechanisms.

**Reconciling direction:** This design's source instructions require keeping coupons simple and
explicitly frame free-access grants and Razorpay discounts as needing separate representation.

**Resolution:** A free-access code is modeled as a [Promotion](../coupons-and-promotions.md) — the
same mechanism as an admin grant — and never as a Razorpay Offer. This was already anticipated as
the likely direction by the earlier feasibility research (`razorpay-feasibility-audit.md`'s mapping
table called this "not applicable / should never touch Razorpay"), so it is confirmed here, not
newly invented.

## R-03 — Upgrade/downgrade/cancellation timing, left open in the product doc, resolved from Razorpay's supported behavior

**Source conflict:** `suscriptions.md` §44, §84 explicitly left upgrade timing, downgrade timing,
and cancellation timing (immediate vs. end-of-period) undecided, deferring to "whichever is required
by product/Razorpay."

**Reconciling direction:** This design's source instructions grant explicit engineering authority to
resolve this using current Razorpay capabilities and common subscription-system practice.

**Resolution:** Immediate upgrade, cycle-end downgrade, cycle-end cancellation by default — see
[`lifecycle.md`](lifecycle.md). Not a contradiction so much as the original document's own deferred
decision being made, but recorded here because a future reader might otherwise assume it remained
open.

## R-04 — "One active Subscription per user" versus preserving halted subscriptions

**Source conflict:** The domain model stated "one active Subscription per user at a time", while
[SB-PF-03](payment-failure-and-recovery.md#sb-pf-03--halted-ends-paid-access-but-never-cancels-the-subscription)
deliberately preserves a `halted` Razorpay subscription so it can recover. The two together allow a
user whose Subscription A is halted to buy Subscription B, after which A can recover to `active` —
two provider subscriptions billing and granting access. Raised in `docs/temp/suscriptions-issues.md`.
The domain documents also described three mutually incompatible identity models (one lineage with a
swappable provider reference; many Subscriptions per user; a "one active" rule that counted `HALTED`).

**Resolution:** One Kizunia Subscription per Razorpay subscription
([SB-UQ-01](uniqueness-and-resubscription.md#sb-uq-01--a-subscription-is-one-razorpay-subscription-bound-once));
the invariant is restated over every *open* phase, not "active"
([SB-UQ-02](uniqueness-and-resubscription.md#sb-uq-02--kizunia-never-creates-a-second-open-subscription-for-a-user));
a halted subscription is superseded only by a user-confirmed, sync-confirmed cancellation
([SB-UQ-04](uniqueness-and-resubscription.md#sb-uq-04--a-halted-or-paused-subscription-is-superseded-only-by-a-confirmed-cancellation));
and any duplicate arising outside Kizunia is detected, never silently resolved
([SB-UQ-05](uniqueness-and-resubscription.md#sb-uq-05--multiple-open-subscriptions-arising-outside-kizunia-are-detected-never-silently-resolved)).

## R-05 — "Enqueue and drain" versus a daily scheduled trigger

**Source conflict:** `razorpay-feasibility-audit.md` §3.7 recommended, and
[SB-WH-05](webhooks-and-reliability.md#sb-wh-05--acknowledgement-happens-before-asynchronous-processing-not-after)
adopted, "persist, acknowledge, enqueue; process on the next queue drain", reusing the notification
work queue. In this repository the queue is drained by the internal tick, which `next/vercel.json`
schedules once a day on Vercel Hobby. The design therefore allowed up to a day between a payment and
the resulting access. The notification subsystem accepts that latency; billing cannot.

**Resolution:** The durable marker moved onto the Subscription itself (sync-due), processing is
attempted immediately after acknowledgement and at checkout confirmation, and the tick is only the
backstop — [SB-WH-05](webhooks-and-reliability.md#sb-wh-05--acknowledgement-happens-before-asynchronous-processing-not-after)
amended, [SB-RC-02](reconciliation.md#sb-rc-02--a-webhook-processing-failure-after-signature-verification-triggers-on-demand-reconciliation)
superseded by [SB-RC-04](reconciliation.md#sb-rc-04--one-synchronization-mechanism-serves-webhooks-commands-and-reconciliation).
The scheduler itself stays a deployment choice, with Vercel Hobby supported
([SB-PB-06](provider-boundary-and-environments.md#sb-pb-06--billing-execution-is-scheduler-agnostic)).

## R-06 — The Update API does not support plan changes for most Indian payment methods

**Source conflict:** `razorpay-feasibility-audit.md` §3.6 and §6 listed "upgrade/downgrade between
paid plans (Update Subscription API)" as fully compatible, and
[SB-LC-02](lifecycle.md#sb-lc-02--upgrades-are-immediate)/[SB-LC-03](lifecycle.md#sb-lc-03--downgrades-take-effect-at-cycle-end)
were built on it. Re-verification on 2026-09-24 found that Razorpay refuses updates for UPI and
e-mandate subscriptions and allows only an Offer change for domestic-card subscriptions
([razorpay-facts](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#upgrade--downgrade)).
The audit's own §3.8 expected UPI AutoPay to be the dominant rail. The earlier ledger even recorded
the UPI/e-mandate restriction, but no ruling accounted for it.

**Resolution (product decision, 2026-09-24):** Kizunia uses Razorpay's native plan change wherever
Razorpay supports it for the specific subscription, with Razorpay's native proration, and builds no
workaround where it does not — no successor subscription, no Kizunia proration or refunds. Where
Razorpay refuses, the plan change is a documented V1 limitation and future scope
([SB-LC-07](lifecycle.md#sb-lc-07--razorpay-decides-whether-a-plan-change-is-possible),
[`../future.md`](../future.md#plan-changes-razorpay-cannot-perform-natively),
[open question B1](../open-decisions.md#b-genuinely-open-product-questions)). Free→paid is creation
and paid→Free is cancellation, both supported for every payment method.
