# Rulings — Lifecycle

> **Status:** Live
>
> **Last Updated:** 2026-09-21

---

## SB-LC-01 — Trial is Razorpay-native only

**Status:** Accepted

**Decision:** Trials use Razorpay's native mechanism — a subscription created with a future
`start_at`, with the authorization/mandate transaction completed immediately. There is no separate
Kizunia-built, no-payment-method trial system.

**Rationale:** [RAZORPAY FACT] Razorpay has no native concept of a card-free trial: the customer
must complete authentication (mandate setup) at trial start regardless of when the first real
charge happens (see
[`../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../architecture/subscription/provider-boundary/razorpay-facts.md#trials)).
Building a separate no-card trial engine — as the original product doc left open as a possibility
(`suscriptions.md` §84) — would mean maintaining a second subscription-like state machine solely
for the pre-payment period, then migrating the user into the real one at conversion. Aligning
trials with the mechanism Razorpay already provides removes that entire second system: "conversion"
becomes nothing more than the ordinary `subscription.activated`/`subscription.charged` webhook path
that every paid subscription already goes through.

**Consequence:** A trial cannot be offered without the user providing a payment method up front.
This is an accepted product trade-off, not an oversight — see
[`../open-decisions.md`](../open-decisions.md) for what remains genuinely undecided about trials
(repeat trials, cooldowns).

## SB-LC-02 — Upgrades are immediate

**Status:** Accepted

**Decision:** Plan upgrades (Free→Pro, Pro→Pro+) apply immediately, using Razorpay's
`schedule_change_at: "now"`. Razorpay automatically generates a prorated invoice and charges the
difference.

**Rationale:** [RAZORPAY FACT] Razorpay's Update Subscription API supports immediate plan changes
with automatic proration on the charge side (see
[`../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../architecture/subscription/provider-boundary/razorpay-facts.md#upgrade-downgrade)).
Immediate upgrade is standard SaaS practice, gives the user immediate value for money already
committed to paying, and requires no Kizunia-side proration logic — Razorpay computes and charges
the difference on its own.

## SB-LC-03 — Downgrades take effect at cycle end

**Status:** Accepted

**Decision:** Plan downgrades (Pro+→Pro, Pro→Free) use `schedule_change_at: "cycle_end"`. The user
keeps current-plan access and billing until the paid period ends, then the lower plan applies.

**Rationale:** [RAZORPAY FACT] Razorpay's own documentation describes downgrade proration as
requiring a merchant-initiated refund for the difference when applied immediately, and explicitly
forces `cycle_end` timing for any subscription with an active Offer (see
[`../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../architecture/subscription/provider-boundary/razorpay-facts.md#upgrade-downgrade)).
Defaulting every downgrade to `cycle_end` avoids building refund-issuing logic entirely, is
consistent behavior regardless of whether an Offer happens to be active, and matches common
subscription-system practice (the user already paid for the period; they keep what they paid for).
This directly resolves the original product doc's explicitly open downgrade-timing question
(`suscriptions.md` §44, §84).

## SB-LC-04 — Cancellation defaults to end-of-cycle

**Status:** Accepted

**Decision:** Customer-initiated cancellation defaults to `cancel_at_cycle_end: true`. The user
keeps paid access through the period already paid for, then falls back to Free.

**Rationale:** [RAZORPAY FACT] `cancel_at_cycle_end` is a native, documented Razorpay parameter (see
[`../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../architecture/subscription/provider-boundary/razorpay-facts.md#cancellation)).
Standard SaaS practice, avoids any refund question, and is the behavior users expect by default.
Resolves the original product doc's explicitly open cancellation-timing question
(`suscriptions.md` §44, §84).

## SB-LC-05 — Immediate cancellation is an explicit admin/support action

**Status:** Accepted

**Decision:** `cancel_at_cycle_end: false` (immediate cancellation) remains available, but is
invoked deliberately (e.g. by support handling a specific case), not offered as the customer
self-serve default.

**Rationale:** Keeps the common path simple and refund-free ([SB-LC-04](#sb-lc-04--cancellation-defaults-to-end-of-cycle))
while not removing a capability Razorpay supports and support staff may legitimately need.

## SB-LC-06 — A Dashboard-originated change is a normal lifecycle path

**Status:** Accepted

**Decision:** Any subscription mutation performed directly in the Razorpay Dashboard (cancellation,
refund, other supported operations) is handled through the exact same webhook-driven pipeline as a
Kizunia-application-initiated change. It is never treated as an exceptional or unsupported case.

**Rationale:** Explicitly required by this design's source instructions: administrators have
Razorpay Dashboard access and are expected to use it operationally. A design that only accounts for
Kizunia-originated mutations would break the moment an admin cancels a subscription from the
Dashboard instead of through the app. See
[`../../../architecture/subscription/lifecycle/dashboard-originated-changes.md`](../../../architecture/subscription/lifecycle/dashboard-originated-changes.md).
