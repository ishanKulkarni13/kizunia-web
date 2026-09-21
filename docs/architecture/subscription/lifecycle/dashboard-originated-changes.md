# Dashboard-Originated Changes

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

An administrator with Razorpay Dashboard access can cancel a subscription, issue a refund, or
perform other supported operations directly against Razorpay — outside the Kizunia application
entirely. See [SB-LC-06](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-06--a-dashboard-originated-change-is-a-normal-lifecycle-path).

---

## Traced end-to-end

```text
Admin cancels a subscription in the Razorpay Dashboard
  -> Razorpay's subscription state changes to `cancelled`
  -> Razorpay sends subscription.cancelled to Kizunia's webhook endpoint
  -> Kizunia verifies the signature (webhooks/security.md)
  -> Kizunia persists the event, deduplicated by event id (webhooks/reliability-and-idempotency.md)
  -> Kizunia's async processor refetches the authoritative Subscription entity
  -> Kizunia updates Subscription.phase = CANCELLED, records a SubscriptionHistoryEntry with
     source = webhook (not "admin" — Kizunia did not initiate this; the *Kizunia* actor is unknown,
     only that Razorpay reported the change)
  -> effective access is recalculated
  -> the user falls back to Free once their paid period, if any remained, actually ends
```

The pipeline is identical to a Kizunia-application-initiated cancellation from
[`cancellation.md`](cancellation.md) — there is no branch, flag, or special case for "this
originated outside Kizunia." The webhook pipeline cannot distinguish a Dashboard action from an API
call Kizunia itself made, and it does not need to.

## Why this must not be an afterthought

Designing only for Kizunia-initiated mutations would mean the webhook handler is only ever
exercised by traffic Kizunia's own code generated — every test would pass, and the first real
Dashboard cancellation in production would be the first time the "did someone else change this"
path actually ran. Because Dashboard operations are explicitly an intended part of how Kizunia
operates this system (per the product direction), this path is exercised by the same tests and the
same code as every other subscription change, not a separately-maintained corner case.

## A refund follows the same shape

A Dashboard-issued refund produces its own `payment.*`/refund-related webhook, recorded as an
append-only fact ([SB-WH-04](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-04--charges-are-recorded-as-append-only-facts-separate-from-current-state)). A refund does not, by itself, change a Subscription's phase — only an
accompanying state-changing event (e.g. a cancellation issued alongside the refund) does.
