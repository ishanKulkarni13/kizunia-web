# Webhook Architecture

> **Status:** Implementation plan — not implemented
>
> **Last Updated:** 2026-09-24
>
> **Blueprint section:** §8 (see the [section map](README.md#blueprint-section-map))

The webhook endpoint: raw-body signature verification, event identity and deduplication, persistence, transaction boundaries, the split between webhook ingestion and subscription state application, ordering, delayed and unmatched events, and secret rotation.

---

Route: `src/app/api/v1/webhooks/razorpay/route.ts`, `POST`, `dynamic = "force-dynamic"`, Node runtime, `maxDuration` ≈ 30. The route holds HTTP only; `WebhookService` is scheduler- and HTTP-agnostic.

```text
INGESTION (request path, < 5 s, no provider call)
 0 rate limit billing:webhook by IP (generous, fail-open)
 1 raw = Buffer.from(await request.arrayBuffer())            -- never parse before verifying
 2 mode disabled -> 400 fail closed (no secret). Else HMAC-SHA256(raw, current) then (previous, if within
   its configured window); constant-time compare. Invalid -> 400 + security log. Stop.
 3 parse JSON -> not JSON: 400 + billing.alert (a signed non-JSON body is serious). Stop.
 4 account_id != RAZORPAY_ACCOUNT_ID -> 400 + security log. Stop.
 5 ONE transaction:
     INSERT BillingEvent(dedupeKey = x-razorpay-event-id ?? sha256(raw), matchedSecret, mode, status)
       P2002 -> UPDATE duplicateCount += 1; COMMIT; goto 6
     subscription.*: find Subscription by (mode, providerSubscriptionId)
         found -> markDue(WEBHOOK, syncRequestedAt = now); link event
         none  -> status UNMATCHED_PENDING
     subscription.charged / refund.processed / payment.dispute.created -> INSERT money fact (unique; dup no-op)
     unsupported type -> SKIPPED_UNSUPPORTED
   COMMIT      (DB failure -> 500; Razorpay retries for 24 h; nothing acknowledged unrecorded)
 6 return 200
STATE APPLICATION (after(), best effort, bounded, priority 2)
 7 UNMATCHED_PENDING -> fetchSubscription; notes.kz_env == mode && kz_sub names a PROVISIONING row -> bind,
   settle create op, mark due; else UNMATCHED + anomaly UNMATCHED_PROVIDER_SUBSCRIPTION (or NOTES_CONFLICT)
 8 targeted claim + sync of the marked subscription (skip if leased elsewhere)
BACKSTOP
 9 anything after() did not finish stays due -> billing:sync tick drains it
```

| Concern | Handling |
| --- | --- |
| Event ID | `x-razorpay-event-id`; absent → `sha256(raw)` with `dedupeSource = BODY_SHA256` (A6 fallback) |
| Duplicates / replays | Unique insert; a replay can only trigger a fetch, never apply payload state |
| Ordering / delayed | Payload status never applied; refetch + stale-apply guard; `syncRequestedAt` > in-flight fetch keeps the row due now |
| Unmatched | Persisted, never dropped; matched only by `notes`; never by email/phone/amount |
| Secret rotation | `RAZORPAY_WEBHOOK_SECRET` + `RAZORPAY_WEBHOOK_SECRET_PREVIOUS` (+ optional `…_PREVIOUS_UNTIL`); `matchedSecret` recorded so the end of rotation is observable |
| Storms / bulk Dashboard actions | One insert + one idempotent mark per event; `after()` capped (C4); the tick drains at the budget's pace |
| Fast 2xx | Only HMAC + one small transaction before the response; latency logged against the 5 s limit |
| Subscribed events | Ten `subscription.*` + `refund.processed` + `payment.dispute.created` (SB-WH-08) |

`after()` is imported from `next/server` (Next 16.1.1). It is used nowhere in the repo yet; it only shortens latency, never carries correctness.

---

## Related documents

**In this directory**

- [Synchronization](synchronization.md)
- [Reconciliation](reconciliation.md)
- [Open decisions](open-decisions.md) · [Settled decisions](settled-decisions.md) · [Index](README.md)

**Design and specification**

- [Webhooks overview](../webhooks/README.md)
- [Webhook security](../webhooks/security.md)
- [Reliability and idempotency](../webhooks/reliability-and-idempotency.md)
- [Ordering and staleness](../webhooks/ordering-and-staleness.md)
- [Event catalog](../webhooks/event-catalog.md)
