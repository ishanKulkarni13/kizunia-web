# Webhooks

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

Treat this as one of the most critical and security-sensitive parts of the whole subsystem. A
Razorpay webhook is not a simple controller receiving JSON and updating a row — it is a
distributed-systems boundary that must survive duplication, reordering, delay, loss, malformed
payloads, and its own processing failing partway through.

| Document | Contents |
| --- | --- |
| [`event-catalog.md`](event-catalog.md) | The full verified event list, and how each is treated |
| [`security.md`](security.md) | Signature verification and why the payload is never trusted alone |
| [`reliability-and-idempotency.md`](reliability-and-idempotency.md) | The full receive-to-processed pipeline |
| [`ordering-and-staleness.md`](ordering-and-staleness.md) | Why state-changing events trigger a refetch |

---

## The pipeline, in one line

```text
receive -> verify signature -> persist (dedupe key) -> acknowledge -> process asynchronously
  -> refetch authoritative state (state-changing events only) -> transactional update + history
  -> effective access recalculated
```

Every stage is covered by a ruling in
[`../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md`](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md).

## What this design assumes can go wrong, and where each is handled

| Failure mode | Handled in |
| --- | --- |
| Duplicate delivery of the same event | [`reliability-and-idempotency.md`](reliability-and-idempotency.md) — unique-constraint dedupe |
| Replayed or delayed delivery | Same — dedupe key is time-independent |
| Out-of-order delivery | [`ordering-and-staleness.md`](ordering-and-staleness.md) — authoritative refetch |
| Malformed or unknown event payload | [`reliability-and-idempotency.md`](reliability-and-idempotency.md) — persisted, marked, never crashes the endpoint |
| Invalid or missing signature | [`security.md`](security.md) — rejected before anything else runs |
| Kizunia's database briefly unavailable | [`reliability-and-idempotency.md`](reliability-and-idempotency.md) — Razorpay's own retry covers this |
| Worker crash mid-processing | [`reliability-and-idempotency.md`](reliability-and-idempotency.md) — reuses the notification work-queue's lease/crash-recovery pattern |
| Acknowledgement succeeds, processing never completes | [`reliability-and-idempotency.md`](reliability-and-idempotency.md) + [`../reconciliation/README.md`](../reconciliation/README.md) — bounded retry, then reconciliation catches it |
| Razorpay itself unreachable during processing (for the authoritative refetch) | [`ordering-and-staleness.md`](ordering-and-staleness.md) — processing fails cleanly, retried, reconciliation is the backstop |
| Razorpay's endpoint disabled after 24h of failures | Operational — [`../cross-cutting/observability.md`](../cross-cutting/observability.md) alerts before this happens |
