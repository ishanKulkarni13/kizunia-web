# Payment Failure and Recovery

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

This is the mechanism behind
[SB-PF-01 through SB-PF-04](../../../project/feature-specification/subscription/decisions/payment-failure-and-recovery.md) — read those rulings for the reasoning; this
page states the resulting behavior precisely.

---

## The full path

```text
active
  |  charge fails
  v
pending  (Kizunia phase: ACTIVE, unchanged — SB-PF-02)
  |  Razorpay retries automatically (cards/UPI: ~3-4 days; e-mandate: bank-dependent)
  |
  +-- retry succeeds --> active  (Kizunia phase: ACTIVE, unchanged)
  |
  +-- all retries exhausted
      v
    halted  (Kizunia phase: HALTED — access ends, SB-PF-03)
      |
      +-- customer updates payment method, Razorpay successfully charges
      |     v
      |   active  (Kizunia phase: ACTIVE — access restored, SB-PF-04, non-destructively)
      |
      +-- customer never fixes it
            subscription remains halted in Razorpay indefinitely; Kizunia stays FREE indefinitely;
            nothing further happens automatically on Kizunia's side
```

## What Kizunia does at each step

| Razorpay event | Kizunia action |
| --- | --- |
| `subscription.pending` | Record in `SubscriptionHistoryEntry`; no access change |
| `subscription.activated` (from `pending`) | Record; no access change (it was already `ACTIVE`) |
| `subscription.halted` | Refetch authoritative state, set phase `HALTED`, recalculate effective access (drops to next-highest source or Free) |
| `subscription.activated` (from `halted`) | Refetch authoritative state, set phase `ACTIVE`, recalculate effective access (restores the plan) |

No Kizunia-owned timer, cron task, or state machine sits between these rows — every transition is
driven directly by a Razorpay webhook (or a [reconciliation](../reconciliation/README.md) refetch if
a webhook was missed). This is the literal implementation of
[SB-PF-01](../../../project/feature-specification/subscription/decisions/payment-failure-and-recovery.md#sb-pf-01--no-second-retry-engine).

## Why this is safe to leave indefinite

A `halted` subscription that never recovers costs nothing — Razorpay is not attempting further
charges, and Kizunia has already fallen back to Free. There is no runaway resource cost to bound,
which is precisely why no additional Kizunia-side expiry timer is needed on top of `halted` itself.
