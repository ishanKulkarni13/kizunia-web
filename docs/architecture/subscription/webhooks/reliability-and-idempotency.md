# Reliability and Idempotency

> **Status:** Implemented in [Phase IV](../implementation-plan/phase-IV/README.md) (2026-09-25); verified against Razorpay TEST
>
> **Last Updated:** 2026-09-24 (pipeline revised: the separate processing job was replaced by the
> sync-due marker and an immediate post-response sync)

The receive-to-applied pipeline. Rulings:
[SB-WH-01 through SB-WH-08](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md).

---

## Why the pipeline changed

The original pipeline persisted the event, acknowledged, then enqueued a job "processed on the next
queue drain". In this repository the drain is the internal tick, scheduled **once a day**
(`next/vercel.json`) — so a payment could wait up to 24 hours to become access
([R-05](../../../project/feature-specification/subscription/decisions/reconciliations.md#r-05--enqueue-and-drain-versus-a-daily-scheduled-trigger)).
The revised pipeline keeps every durability property and removes the dependency on the tick for the
common case.

## The pipeline

```text
1. RECEIVE     POST /api/v1/webhooks/razorpay; raw body captured unparsed
2. VERIFY      HMAC-SHA256 over the raw body with the current secret, else the previous secret
               during a rotation window (security.md). Invalid -> 400, security log, stop.
               Provider mode disabled -> no secret -> fail closed, stop.
3. PARSE       JSON parsed only after verification. Unparseable -> 400, anomaly log, stop.
4. RECORD      ONE transaction:
                 a. INSERT BillingEvent(provider, dedupeKey, eventType, providerSubscriptionId,
                    accountId, createdAt, rawPayload, matchedSecret, status = RECORDED)
                    dedupeKey = x-razorpay-event-id, or sha256(raw body) if absent (SB-WH-02)
                    unique violation -> duplicate: COMMIT nothing new, go to 5
                 b. resolve the local Subscription by providerSubscriptionId
                      found      -> mark sync-due (reason = webhook), link the event
                      not found  -> status = UNMATCHED_PENDING (resolved in 6)
                 c. subscription.charged / refund.processed / payment.dispute.created
                      -> INSERT the append-only fact, keyed by its payment/refund/dispute id
                         (unique; a duplicate is a no-op) (SB-WH-04)
                 d. unsupported event type -> status = SKIPPED_UNSUPPORTED
               COMMIT
5. ACKNOWLEDGE 2xx. Everything Razorpay needs is durable; nothing below can change the response.
6. AFTER       after(): best effort, bounded, budget priority 2
                 - UNMATCHED_PENDING: fetch the provider subscription, read notes
                     notes.kz_sub names a PROVISIONING record in this mode -> bind, mark sync-due
                     otherwise -> status UNMATCHED, anomaly UNMATCHED_PROVIDER_SUBSCRIPTION (SB-WH-06)
                 - claim and sync the marked Subscription (reconciliation/sync-mechanism.md)
7. BACKSTOP    Anything step 6 did not finish stays due; the billing-sync tick task drains it.
```

The only work between receipt and the 2xx is a signature check and one small transaction. A
database outage at step 4 returns 5xx and Razorpay retries (for 24 hours); nothing was acknowledged
that was not recorded.

## What each guarantee rests on

| Guarantee | Rests on |
| --- | --- |
| No acknowledged event is lost | Step 4 commits before step 5 |
| A redelivered event does nothing twice | Unique `dedupeKey`; unique fact keys |
| Processing is never skipped | The sync-due marker is written in the same transaction as the event |
| Out-of-order delivery cannot regress state | Payload status is never applied; sync fetches current state; stale-apply guard ([`ordering-and-staleness.md`](ordering-and-staleness.md)) |
| An event burst costs one provider call per subscription | Coalescing marker |
| Razorpay's 5-second budget is never at risk | No provider call before the 2xx |
| Access follows within seconds | `after()` sync |
| Access still follows if `after()` never runs | The tick drains the marker |

## "Was this event processed?"

There is no per-event processing status to keep in step with the subscription, because the event
itself is never "processed" — it only requests a sync. An event is **applied** when a sync whose
observation time is later than the event's receipt succeeded for its Subscription:
`subscription.lastAppliedObservationAt > billingEvent.receivedAt`. This is derived, so it can never be
wrong, and it answers the support question directly. `BillingEvent.status` records only what is
knowable at receipt: `RECORDED`, `UNMATCHED_PENDING`, `UNMATCHED`, `SKIPPED_UNSUPPORTED`.

## Idempotency is a database constraint, not a check

Every dedupe here is a unique-constraint insert where a `P2002` violation means "already done" — the
convention the notification subsystem established for its own idempotent inserts. It is atomic under
concurrent delivery in a way a read-then-write existence check is not.

## Crash recovery

| Crash point | Recovery |
| --- | --- |
| Before step 4 commits | Nothing recorded, no 2xx sent; Razorpay retries |
| After step 4, before 2xx | Razorpay retries; step 4 hits the dedupe key; 2xx |
| During step 6 | Sync lease expires; the tick reclaims the Subscription |
| During a tick drain | Same |

No other recovery mechanism exists or is needed.

## Malformed and unknown payloads never crash the endpoint

A payload that verifies but is an unknown event type is recorded as `SKIPPED_UNSUPPORTED` — a new
Razorpay event type never becomes a failure. A verified body that is not JSON is rejected with 400
(Razorpay will retry it; it will fail identically and eventually stop) and raised as an anomaly,
because a correctly signed non-JSON body means something is seriously wrong.

## Endpoint disablement

**FACT.** After 24 hours of failed deliveries Razorpay disables the webhook until it is re-enabled in
the Dashboard ([razorpay-facts](../provider-boundary/razorpay-facts.md#webhooks)). Detection and
recovery are in [`../cross-cutting/operations-runbook.md`](../cross-cutting/operations-runbook.md#webhook-endpoint-disabled-or-failing);
due-based reconciliation keeps state correct in the meantime, at checkpoint latency.
