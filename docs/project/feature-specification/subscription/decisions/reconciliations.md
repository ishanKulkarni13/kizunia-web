# Reconciliations

> **Status:** Live
>
> **Last Updated:** 2026-09-21

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
