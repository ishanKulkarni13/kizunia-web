# Reliability and Idempotency

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

The full pipeline, reusing the notification subsystem's proven Postgres-backed work-queue pattern
rather than inventing new infrastructure.

---

## The pipeline

```text
1. RECEIVE     POST /api/v1/webhooks/razorpay, raw body captured unparsed
2. VERIFY      HMAC-SHA256 signature check (security.md) — reject 4xx and stop if invalid
3. PARSE       JSON body parsed only after verification succeeds
4. PERSIST     INSERT BillingEvent (provider='razorpay', providerEventId=<x-razorpay-event-id>, ...)
               unique constraint on (provider, providerEventId)
               -> constraint violation = already seen -> treat as success, skip to step 5
5. ACKNOWLEDGE Respond 2xx now — this is what keeps Kizunia inside Razorpay's 5-second budget,
               regardless of how long step 6 takes
6. ENQUEUE     A job referencing the BillingEvent id is placed on the existing Postgres work queue
7. PROCESS     (asynchronously, on the next queue drain — see below)
               - load the BillingEvent
               - for a state-changing event: fetch authoritative Subscription from Razorpay
                 (ordering-and-staleness.md)
               - for a fact event: nothing further needed beyond the persisted record itself
               - inside a DB transaction: update Subscription.phase (if changed), write a
                 SubscriptionHistoryEntry, recalculate effective access
               - mark BillingEvent PROCESSED
8. RETRY       On processing failure, the job's existing bounded-retry/backoff (reused from the
               notification work queue) applies. Exhausting retries marks the event FAILED and
               triggers on-demand reconciliation (SB-RC-02)
```

## Why persistence happens before acknowledgement, and processing after

Step 4 must complete before step 5, because acknowledging an event Kizunia never durably recorded
would mean a subsequent redelivery of the *same* event — which Razorpay's at-least-once delivery
makes routine, not exceptional — would have no dedupe record to match against, and would be
processed twice. Step 6/7 happen after acknowledgement because Razorpay's 5-second response budget
must not be spent on a database transaction plus a Razorpay API refetch — see
[SB-WH-05](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-05--acknowledgement-happens-before-asynchronous-processing-not-after).

## Idempotency is a database constraint, not a check

Step 4's dedupe is a unique-constraint insert, and a `P2002` violation is treated as "already
processed, nothing to do" — the exact convention the notification subsystem already established for
its own idempotent inserts (`(userId, intent, occurrenceKey)` on `Notification`). This is atomic
under concurrent delivery of the same event in a way a read-then-write existence check is not.

## "Asynchronous" means the next queue drain, not a background thread

There is no long-running worker process in this codebase (`docs/architecture/workflows/internal-jobs.md`).
"Asynchronous" here means: the job sits in the Postgres-backed queue until the next invocation of the
`internal-jobs` tick drains it — the same model the notification subsystem's own delivery pipeline
already uses. This introduces latency between webhook receipt and entitlement update bounded by the
tick's cadence, which is acceptable for billing state changes (not a sub-second UI-critical path) and
identical in kind to the latency the notification subsystem already accepts for delivery.

## Crash recovery

The queue reuses the notification work queue's claim-with-lease pattern (`SELECT ... FOR UPDATE SKIP
LOCKED` plus a lease expiry) so that a worker crashing mid-processing does not lose the job — a
future drain reclaims it once its lease expires. No new crash-recovery mechanism is designed; the
existing one is reused as-is.

## Malformed and unknown payloads never crash the endpoint

A payload that parses but doesn't match any known event shape is still persisted (step 4) and marked
`SKIPPED_UNSUPPORTED` at processing time — see
[`event-catalog.md`](event-catalog.md#unknown-or-unsupported-events). A payload that fails to parse
as JSON at all (should not happen post-signature-verification for a legitimate Razorpay payload, but
is not assumed impossible) is rejected with a 4xx before step 4, and logged as an anomaly.

## Out-of-order delivery

Handled by refetching authoritative state rather than trusting delivery order at all — see
[`ordering-and-staleness.md`](ordering-and-staleness.md). This pipeline does not attempt to
sequence events by timestamp before processing them.
