# Trials

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

Trials use Razorpay's native mechanism only — see
[SB-LC-01](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-01--trial-is-razorpay-native-only).

---

## Mechanism

Starting a trial creates a Razorpay subscription with a future `start_at`. The customer completes
the authorization/mandate transaction immediately (Razorpay auto-refunds the small authorization
charge). Kizunia maps this to phase `TRIALING` — see
[`state-mapping.md`](state-mapping.md) — and the trial's plan contributes to effective access
starting immediately, not at `start_at`.

```text
createSubscription(plan, customer, { trialStartAt: <30 days from now> })
  -> Razorpay: authenticated, start_at = T+30d
  -> Kizunia: Subscription.phase = TRIALING, plan = PRO
  -> effective access includes PRO from creation, through T+30d
```

## Conversion is not a separate code path

At `start_at`, Razorpay attempts the first real charge automatically. This produces the ordinary
`subscription.activated`/`subscription.charged` webhook sequence — exactly what a brand-new,
non-trial subscription's first charge produces. Kizunia's webhook handler does not need to know a
trial preceded it; the phase transitions `TRIALING → ACTIVE` the same way `PENDING_AUTHENTICATION →
ACTIVE` does. No dedicated "trial conversion" handler exists.

## Cancelling during a trial

Cancelling before `start_at` uses the same [cancellation](cancellation.md) path as any other
subscription. Since no charge has occurred yet, this reaches `CANCELLED` with nothing to refund.

## What is not built

- A no-payment-method trial variant.
- Trial-eligibility tracking ("has this user had a trial before") — Razorpay has no concept of this
  at all; if Kizunia ever needs one, it is Kizunia-side bookkeeping keyed on its own user identity,
  not something a Razorpay lookup can answer. Not built in V1 — see
  [`../../../project/feature-specification/subscription/open-decisions.md`](../../../project/feature-specification/subscription/open-decisions.md).
