# Ordering and Staleness

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

---

## The problem

**FACT.** Razorpay explicitly documents that webhook events are not guaranteed to arrive in order
(see [`../provider-boundary/razorpay-facts.md`](../provider-boundary/razorpay-facts.md#webhooks)).
An older event (say, `subscription.pending`, generated when a charge first failed) can be delivered
*after* a newer one (`subscription.halted`, generated once retries exhausted) if the first delivery
attempt for the older event was delayed or retried.

Applying event payloads directly, in delivery order, as the new "current state" would let the stale
`pending` event overwrite the correct `halted` state — a real regression, not a theoretical one.

## The resolution: refetch, don't trust

For every state-changing event (see [`event-catalog.md`](event-catalog.md#state-changing-events-trigger-an-authoritative-refetch)),
Kizunia does not read the new phase from the webhook payload. It calls Razorpay's Fetch Subscription
API for that subscription's current, authoritative state, and derives the new Kizunia phase from
that response. See
[SB-WH-03](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-03--state-changing-events-trigger-an-authoritative-refetch).

```text
webhook arrives (subscription.pending, possibly stale)
  -> Kizunia does NOT set phase = "still pending" from the payload
  -> Kizunia calls fetchSubscription(providerRef)
  -> Razorpay returns current state: halted (the true, current state)
  -> Kizunia sets phase = HALTED
```

Because the refetch always reflects Razorpay's *current* state regardless of which event triggered
it, the eventual outcome is correct even if the events themselves arrived out of order — the last
webhook to be *processed* still produces the *current* truth, not a snapshot from whenever it was
originally generated.

## What if the refetch itself races with a newer webhook's refetch?

Two webhooks for the same subscription processed concurrently could each fetch the same current
state and attempt the same update — this is idempotent by construction: applying "set phase to X"
twice, where both refetches agree on X because both queried the same authoritative source, produces
one correct outcome, not a conflict. The transactional update in
[`reliability-and-idempotency.md`](reliability-and-idempotency.md) is a straightforward "set current
phase" write, not an increment or delta, so repeating it is safe.

## What "stale" means for history

Even though a stale event's payload is never applied as current state, the event itself is still
recorded in full via `BillingEvent` ([SB-WH-02](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-02--every-received-event-is-persisted-with-a-unique-constraint-dedupe-key-before-acknowledgement)) — nothing about this design discards
information, it only refuses to let a possibly-stale payload drive the *current-state* write.

## If the refetch fails because Razorpay is unreachable

Processing fails cleanly (see [`reliability-and-idempotency.md`](reliability-and-idempotency.md)'s
retry step); the event is retried on the existing job-runner backoff, and if that budget is
exhausted, [`../reconciliation/README.md`](../reconciliation/README.md)'s on-demand trigger
([SB-RC-02](../../../project/feature-specification/subscription/decisions/reconciliation.md#sb-rc-02--a-webhook-processing-failure-after-signature-verification-triggers-on-demand-reconciliation)) is the backstop. The user's existing local state is left untouched in the
meantime — see [`../provider-availability/outage-and-stale-state.md`](../provider-availability/outage-and-stale-state.md).
