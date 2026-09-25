# Ordering and Staleness

> **Status:** Implemented in [Phase IV](../implementation-plan/phase-IV/README.md) (2026-09-25); verified against Razorpay TEST
>
> **Last Updated:** 2026-09-24 (corrected: concurrent refetches are not idempotent by themselves)

---

## The problem

**FACT.** "you may not always receive the webhooks in order" ([razorpay-facts](../provider-boundary/razorpay-facts.md#webhooks)).
An older event (say, `subscription.pending`, generated when a charge first failed) can be delivered
*after* a newer one (`subscription.halted`) if the first delivery attempt for the older event was
delayed or retried. Applying payloads in delivery order would let the stale `pending` overwrite the
correct `halted` state.

## Part one: refetch, don't trust

For every event that concerns a subscription, Kizunia does not read the new phase from the payload.
It marks the Subscription sync-due, and the sync fetches the current authoritative entity
([SB-WH-03](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-03--state-changing-events-trigger-an-authoritative-refetch)).

```text
webhook arrives (subscription.pending, possibly stale)
  -> Kizunia does NOT set phase from the payload
  -> Subscription marked sync-due
  -> sync fetches: Razorpay returns current state = halted
  -> phase = HALTED
```

## Part two: the fetches themselves can arrive out of order

Refetching is necessary but not sufficient. The earlier version of this document claimed that two
concurrent refetches "agree because both queried the same authoritative source". They do not:

```text
t1  worker A sends fetch         (Razorpay: active)
t2  subscription is cancelled at Razorpay
t3  worker B sends fetch         (Razorpay: cancelled)
t4  worker B applies CANCELLED
t5  worker A's slow response arrives and applies ACTIVE      <- regression
```

Resolved by the stale-apply guard
([SB-RC-08](../../../project/feature-specification/subscription/decisions/reconciliation.md#sb-rc-08--a-synchronization-result-is-applied-only-if-it-is-newer-than-the-last-one-applied)):
every observation carries the time its request was *sent*, and is applied under the Subscription's
row lock only if that time is later than the last applied observation. At t5, A's observation (sent
at t1) is older than B's (sent at t3) and is discarded. The same guard covers a command response
racing a webhook-triggered fetch. Mechanism: [`../reconciliation/sync-mechanism.md`](../reconciliation/sync-mechanism.md#applying-an-observation).

Coalescing reduces how often this race can occur (one pending sync per subscription, claimed under
a lease), but only the guard makes it harmless.

## Part three: an event that arrives while a fetch is in flight

If a webhook arrives after a fetch was sent but before it is applied, that fetch may not reflect the
event. The sync mechanism records when the latest trigger arrived, and if it is later than the
applied observation, keeps the Subscription due immediately instead of scheduling its next
checkpoint — so every event is eventually observed by a fetch sent after it arrived.

## What "stale" means for history

A stale event is still recorded in full as a `BillingEvent`
([SB-WH-02](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-02--every-received-event-is-persisted-with-a-unique-constraint-dedupe-key-before-acknowledgement)),
and a discarded stale observation is logged. Nothing is thrown away; a possibly-stale input is only
never allowed to drive the current-state write.

## If the fetch fails

Nothing local changes; the Subscription stays due with backoff, subject to the global cooldown
([`../reconciliation/provider-rate-limits.md`](../reconciliation/provider-rate-limits.md#provider-failure-taxonomy)).
The user's existing access is left untouched — see
[`../provider-availability/outage-and-stale-state.md`](../provider-availability/outage-and-stale-state.md).

## Why not order by payload timestamps

Payloads carry `created_at`, but sequencing events by it would still apply payload state, which is
exactly what part one refuses to do; and it could not order a webhook against a command response or
a reconciliation fetch. Observation time of an authoritative read is the one ordering that covers
every source.
