# Cancellation

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

---

## Default — cycle end

```text
cancelSubscription(ref, { atCycleEnd: true })
  -> Razorpay marks the subscription for cancellation at current_end
  -> subscription.updated webhook fires (no state change yet)
  -> user keeps current plan/access through the paid period
  -> at cycle end, Razorpay moves the subscription to cancelled
  -> subscription.cancelled webhook fires
  -> Kizunia refetches, sets Subscription.phase = CANCELLED
  -> effective access falls back to whatever the next-highest currently valid source provides,
     or FREE if none
```

See [SB-LC-04](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-04--cancellation-defaults-to-end-of-cycle).

## Immediate cancellation — an explicit, deliberate action

```text
cancelSubscription(ref, { atCycleEnd: false })
  -> subscription.cancelled fires immediately
  -> access ends immediately
```

Reserved for support-handled cases (refund requests, account closure), not exposed as the
self-serve default. See
[SB-LC-05](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-05--immediate-cancellation-is-an-explicit-adminsupport-action).

## Cancellation never deletes data

Reaching `CANCELLED` is a phase transition on the existing `Subscription` record, never a deletion —
see [`../../../project/feature-specification/subscription/data-preservation.md`](../../../project/feature-specification/subscription/data-preservation.md).
