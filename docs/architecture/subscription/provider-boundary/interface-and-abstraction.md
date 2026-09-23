# Interface and Abstraction

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24

The provider boundary is a narrow interface, sized to exactly the operations Kizunia needs. See
[SB-PB-01](../../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-01--the-provider-boundary-is-sized-not-generic)
(amended 2026-09-24: the operation list grew with Kizunia's actual needs).

---

## The shape

```text
-- mutations (only ever called by commands — commands/operation-model.md)
createSubscription(plan, cycle, { kind, trialStartAt?, expireBy, offerId?, notes })
                                                  -> Outcome<ProviderSubscriptionState>
updateSubscriptionPlan(ref, planId, scheduleChangeAt)  -> Outcome<ProviderSubscriptionState>
cancelScheduledChange(ref)                        -> Outcome<ProviderSubscriptionState>
cancelSubscription(ref, { atCycleEnd })           -> Outcome<ProviderSubscriptionState>

-- reads (sync, orphan discovery, advisory capability)
fetchSubscription(ref)                            -> Outcome<ProviderSubscriptionState>
listSubscriptions(window { from, to }, page { count <= 100, skip })
                                                  -> Outcome<Page<ProviderSubscriptionState>>
fetchAuthorizationPaymentMethod(paymentRef)       -> Outcome<PaymentMethodInfo>

-- inbound verification (no network)
verifyWebhookSignature(rawBody, header, secrets[])  -> { valid, matchedSecret }
parseWebhookEvent(rawBody)                        -> ProviderWebhookEvent | Malformed
verifyCheckoutSignature(paymentId, providerSubscriptionId, signature) -> boolean
```

Every network operation:

- acquires a slot from the [provider request budget](../reconciliation/provider-rate-limits.md) at the
  caller's priority before sending, and respects the global cooldown;
- records the request send time (the observation time used by the stale-apply guard);
- uses a bounded client timeout;
- returns `Outcome<T>` = `SUCCESS(T, observationAt)` or one failure class from the
  [provider failure taxonomy](../reconciliation/provider-rate-limits.md#provider-failure-taxonomy).
  No Razorpay SDK error, HTTP status or error string crosses the boundary.

Everything on the right-hand side (`ProviderSubscriptionState`, `PaymentMethodInfo`,
`ProviderWebhookEvent`) is a Kizunia-defined shape translated from Razorpay's response — never a
re-exported SDK type. `ProviderSubscriptionState` carries the normalized fields the sync apply path
needs (status, plan ID, period, `charge_at`, scheduled change, `start_at`, `expire_by`, `offer_id`,
`notes`) plus the raw status string, which stays inside the billing module.

Validation happens at the boundary: an unknown status, missing required fields, or `notes`
inconsistent with the record being synchronized is `MALFORMED`, not a best-effort guess.

## Why not more

Refunds, pause/resume, Offer linking after creation and invoice operations are not boundary
operations: Kizunia does not initiate them in V1. They happen in the Razorpay Dashboard and reach
Kizunia as observations. None gets a method until a real Kizunia use case needs to call it.

## Why not less

- `fetchSubscription` is required by [SB-WH-03](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-03--state-changing-events-trigger-an-authoritative-refetch).
- `listSubscriptions` is the only way to recover a create whose response was lost
  ([SB-RC-09](../../../project/feature-specification/subscription/decisions/reconciliation.md#sb-rc-09--provider-subscriptions-kizunia-lost-track-of-are-found-by-a-bounded-scan)).
- `cancelScheduledChange` is required by [SB-LC-08](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-08--at-most-one-scheduled-change-and-cancellation-always-wins).
- `fetchAuthorizationPaymentMethod` backs the advisory plan-change capability
  ([SB-LC-07](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-07--razorpay-decides-whether-a-plan-change-is-possible)),
  because the subscription entity has no payment-method field.
- `verifyCheckoutSignature` backs [SB-CM-06](../../../project/feature-specification/subscription/decisions/commands-and-idempotency.md#sb-cm-06--checkout-confirmation-syncs-only-the-callers-own-subscription).

## Disabled mode

In `disabled` mode every network operation returns a typed `BillingProviderUnavailable` without
attempting a request, and webhook verification has no secret and fails closed
([`../provider-availability/disabled-provider-mode.md`](../provider-availability/disabled-provider-mode.md)).

## What implements this interface

A single Razorpay implementation, holding all Razorpay SDK usage and HTTP calls, the per-mode plan
catalog ([SB-PB-05](../../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-05--provider-plan-ids-map-to-kizunia-plans-through-a-per-mode-catalog-many-to-one)),
and knowledge of Razorpay's request/response shapes and error codes. Tests use a fake implementing the
same interface — including every failure class — for Kizunia-side logic; the real implementation is
verified against TEST mode ([`../cross-cutting/testing-without-razorpay.md`](../cross-cutting/testing-without-razorpay.md)).

## What is explicitly rejected

```text
UniversalPaymentProvider
    createEverything()
    doEverything()
    supportEveryFutureProvider()
```

No such interface exists in this design, and none should be introduced without a second, real
provider actually needing it.
