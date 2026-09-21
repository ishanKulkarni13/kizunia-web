# Observability

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

Billing is financially sensitive; every stage of the webhook/reconciliation pipeline is expected to
be traceable end to end.

---

## Correlation

Every log line in the webhook/reconciliation path carries: the Razorpay event id
(`x-razorpay-event-id`), the internal `BillingEvent` id, and the Kizunia `Subscription` id where
known. This triple is enough to reconstruct one event's entire journey — received, verified,
persisted, acknowledged, processed, and its resulting `SubscriptionHistoryEntry` — across
[`../webhooks/reliability-and-idempotency.md`](../webhooks/reliability-and-idempotency.md)'s stages.

## What is logged at each stage

| Stage | Logged |
| --- | --- |
| Receive | Event id, event type, timestamp |
| Verify | Success/failure only — never the signature or secret |
| Persist | New vs. duplicate (constraint-violation) outcome |
| Acknowledge | Response latency, to watch against Razorpay's 5-second budget |
| Process | State-mapping outcome (old phase → new phase, or "no change"/"stale, skipped") |
| Reconciliation | Per-subscription: drift found / no drift, and the correction applied if any |

## What must never be logged

Raw webhook payloads in full (they may include customer contact details), payment instrument data,
webhook secrets, or API credentials. Logging the event id and type is sufficient to look up the full
persisted `BillingEvent` row when deeper investigation is genuinely needed, behind whatever access
control protects that table — logs themselves are not the place to hold the raw payload for casual
reading.

## Alerting

| Condition | Why it matters |
| --- | --- |
| A spike in signature-verification failures | Possible probing/attack against the webhook endpoint |
| A `BillingEvent` exhausting its processing retry budget | Reconciliation will catch it, but this is worth surfacing before reconciliation's next pass |
| Reconciliation finding drift beyond a small expected baseline | May indicate a systemic webhook delivery problem, not isolated misses |
| A subscription remaining `HALTED` past a configured observation window | Not an automatic action — see [`../lifecycle/payment-failure-and-recovery.md`](../lifecycle/payment-failure-and-recovery.md) — but worth surfacing to support/ops as a candidate for outreach |
| Provider mode resolving to `disabled` in a production environment | Expected during the pre-live-credentials window ([SB-PB-03](../../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-03--disabled-is-a-fully-supported-production-state)), but worth a visible signal so it's a deliberate, known state rather than an unnoticed one |
