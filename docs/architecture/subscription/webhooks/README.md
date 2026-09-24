# Webhooks

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24

Treat this as one of the most critical and security-sensitive parts of the whole subsystem. A
Razorpay webhook is not a simple controller receiving JSON and updating a row — it is a
distributed-systems boundary that must survive duplication, reordering, delay, loss, malformed
payloads, and its own processing failing partway through.

| Document | Contents |
| --- | --- |
| [`event-catalog.md`](event-catalog.md) | The verified event list, which are subscribed, and how each is treated |
| [`security.md`](security.md) | Signature verification, secret rotation, forged/replayed/cross-account events |
| [`reliability-and-idempotency.md`](reliability-and-idempotency.md) | The receive-to-applied pipeline |
| [`ordering-and-staleness.md`](ordering-and-staleness.md) | Why events trigger a refetch, and why the refetch needs a stale-apply guard |

---

## The pipeline, in one line

```text
receive -> verify signature -> one transaction (dedupe insert + charge fact + mark subscription
sync-due) -> 2xx -> after(): authoritative fetch -> guarded apply + history -> (tick drains anything
after() did not finish)
```

Every stage is covered by a ruling in
[`../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md`](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md).
The fetch-and-apply half is the shared [sync mechanism](../reconciliation/sync-mechanism.md).

## What this design assumes can go wrong, and where each is handled

| Failure mode | Handled in |
| --- | --- |
| Duplicate delivery of the same event | [`reliability-and-idempotency.md`](reliability-and-idempotency.md) — unique-constraint dedupe |
| Replayed or delayed delivery | Same — dedupe key is time-independent; replay only triggers a fetch |
| Out-of-order delivery | [`ordering-and-staleness.md`](ordering-and-staleness.md) — authoritative refetch + stale-apply guard |
| Two fetches for one subscription completing out of order | Same — stale-apply guard |
| Burst of events for one subscription | Coalescing sync-due marker — one fetch |
| Event for a subscription Kizunia has no record of | [SB-WH-06](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-06--events-for-unknown-subscriptions-are-persisted-and-matched-never-dropped) — matched via `notes`, else flagged |
| Malformed or unknown event payload | [`reliability-and-idempotency.md`](reliability-and-idempotency.md) — recorded, marked, never crashes the endpoint |
| Invalid or missing signature | [`security.md`](security.md) — rejected before anything else runs |
| Webhook secret rotated while retries are pending | [`security.md`](security.md#secret-rotation) — previous secret accepted in a bounded window |
| Kizunia's database briefly unavailable | Nothing acknowledged; Razorpay's own 24-hour retry covers it |
| Crash after acknowledging | The sync-due marker was committed with the event; the tick drains it |
| Razorpay unreachable for the authoritative fetch | Backoff + global cooldown; local state untouched ([`../reconciliation/provider-rate-limits.md`](../reconciliation/provider-rate-limits.md)) |
| Razorpay rate-limits the fetches | Same — the fetch shares the global request budget |
| Webhook disabled after 24 h of failures | [`../cross-cutting/operations-runbook.md`](../cross-cutting/operations-runbook.md#webhook-endpoint-disabled-or-failing); due-based reconciliation keeps state correct meanwhile |
