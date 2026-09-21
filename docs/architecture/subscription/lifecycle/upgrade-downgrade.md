# Upgrade / Downgrade

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

---

## Upgrade — immediate

```text
updateSubscription(ref, { planId: PRO_PLUS, scheduleChangeAt: "now" })
  -> Razorpay generates a prorated invoice, auto-charges the difference
  -> subscription.charged webhook fires
  -> Kizunia refetches authoritative state (SB-WH-03), updates Subscription.plan
  -> effective access includes PRO_PLUS immediately
```

See [SB-LC-02](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-02--upgrades-are-immediate).
No Kizunia-side proration calculation exists — Razorpay computes and charges the difference on its
own, and Kizunia only reacts to the resulting webhook.

## Downgrade — cycle end

```text
updateSubscription(ref, { planId: PRO, scheduleChangeAt: "cycle_end" })
  -> Razorpay marks has_scheduled_changes = true, change_scheduled_at set
  -> subscription.updated webhook fires (no state change yet)
  -> Kizunia records the scheduled change; user keeps current plan/access until cycle end
  -> at cycle end, Razorpay applies the change; a webhook reflects the new plan
  -> Kizunia refetches, updates Subscription.plan, recalculates effective access
```

See [SB-LC-03](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-03--downgrades-take-effect-at-cycle-end).
A subscription with an active Offer is forced to `cycle_end` by Razorpay regardless — see
[`../provider-boundary/razorpay-facts.md`](../provider-boundary/razorpay-facts.md#upgrade--downgrade)
— so defaulting every downgrade to `cycle_end` produces one consistent code path rather than a
branch on whether an Offer happens to be active.

## Surfacing a pending downgrade

Razorpay's `has_scheduled_changes`/`change_scheduled_at` fields are exactly what a "your plan
changes to Pro on <date>" UI element would read — mirrored onto Kizunia's own `Subscription` record
so the UI never queries Razorpay directly for this.

## Below the minimum proration threshold

**OPEN** — see
[`../../../project/feature-specification/subscription/open-decisions.md`](../../../project/feature-specification/subscription/open-decisions.md).
Razorpay rejects an update whose prorated difference is below its minimum chargeable amount. Until
the exact INR threshold is confirmed in TEST mode, an upgrade/downgrade that Razorpay rejects for
this reason surfaces as a generic "this plan change isn't possible right now" error rather than a
guessed, possibly-wrong specific message.
