# Interface and Abstraction

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

The provider boundary is a narrow interface, sized to exactly the operations Kizunia needs. See
[SB-PB-01](../../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-01--the-provider-boundary-is-sized-not-generic).

---

## The shape

Conceptually, six operations — no more:

```text
createSubscription(plan, customer, options: { trialStartAt?, offerId? }) -> ProviderSubscriptionRef
fetchSubscription(providerRef) -> ProviderSubscriptionState
updateSubscription(providerRef, { planId?, offerId?, scheduleChangeAt }) -> ProviderSubscriptionState
cancelSubscription(providerRef, { atCycleEnd }) -> ProviderSubscriptionState
verifyWebhookSignature(rawBody, signatureHeader) -> boolean
parseWebhookEvent(rawBody) -> ProviderWebhookEvent
```

Everything on the right-hand side (`ProviderSubscriptionRef`, `ProviderSubscriptionState`,
`ProviderWebhookEvent`) is a Kizunia-defined shape translated from Razorpay's response — never a
re-exported Razorpay SDK type. Domain services depend on these Kizunia-defined shapes, never on the
Razorpay SDK directly.

## Why not more

A generic provider abstraction would also want to cover things Razorpay does that Kizunia has no
current need to abstract over: Offers, refunds, multiple payment methods, Dashboard-only
operations. None of those get a boundary method until a real Kizunia use case needs one called from
outside the provider boundary. Until then, they are handled as one-off, explicitly Razorpay-specific
calls inside the boundary implementation — not hidden behind a speculative generic method.

## Why not less

Fetching authoritative state (`fetchSubscription`) is not optional convenience — it is required by
[SB-WH-03](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-03--state-changing-events-trigger-an-authoritative-refetch), since webhook payloads are not
trusted alone for state transitions. Signature verification and event parsing are required by every
document in [`../webhooks/`](../webhooks/README.md).

## What implements this interface

Today: a single Razorpay implementation, holding all Razorpay SDK usage, HTTP calls to Razorpay's
API, and knowledge of Razorpay's request/response shapes. If a second provider is ever required
(see [`../../../project/feature-specification/subscription/future.md`](../../../project/feature-specification/subscription/future.md)),
it implements the same interface — this is what "sized, not generic" buys without needing to build
a second provider today to prove the abstraction works.

## What is explicitly rejected

```text
UniversalPaymentProvider
    createEverything()
    doEverything()
    supportEveryFutureProvider()
```

No such interface exists in this design, and none should be introduced without a second, real
provider actually needing it.
