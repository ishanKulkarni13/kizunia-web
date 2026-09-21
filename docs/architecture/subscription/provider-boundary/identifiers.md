# Identifiers

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

Kizunia owns its own domain identifiers. Razorpay identifiers are stored only as provider-reference
metadata, never as the backbone of any domain relationship.

---

## The rule

No code outside [`interface-and-abstraction.md`](interface-and-abstraction.md)'s implementation ever
writes:

```text
if (razorpaySubscription.status === "active") { ... }
if (razorpayPlanId === "...") { ... }
```

Provider state is translated into Kizunia's own vocabulary (a `Subscription` phase, from
[`../lifecycle/state-mapping.md`](../lifecycle/state-mapping.md)) at the boundary, once, and
everything downstream consumes that translation.

## Why this is not optional

**FACT.** A cancelled Razorpay subscription cannot be reactivated — resubscribing produces a
brand-new Razorpay subscription ID (see
[`razorpay-facts.md`](razorpay-facts.md#lifecycle-states)). If Kizunia's own subscription history
were keyed on the Razorpay ID, a user's continuity would visibly break every time they cancelled and
resubscribed — their "subscription" would appear to be a different entity each time, undermining
the exact history requirement in
[`../history-and-audit/subscription-history.md`](../history-and-audit/subscription-history.md).

Keeping Kizunia's own `Subscription` identity stable, with the Razorpay reference as an attached,
replaceable field, means a cancel → resubscribe cycle is one more entry in that Subscription's
history, not a discontinuity.

## What is stored, and where

| Field | Lives on |
| --- | --- |
| Razorpay subscription ID | `ProviderReference`, attached to the current `Subscription` |
| Razorpay plan ID | `ProviderReference` |
| Active Razorpay Offer ID | `ProviderReference` |
| Razorpay's raw status string | Nowhere persisted outside the `BillingEvent` raw payload — translated to a phase immediately, never stored as if it were Kizunia's own state |

See [`../../domain/subscription/entities.md`](../../domain/subscription/entities.md#providerreference).
