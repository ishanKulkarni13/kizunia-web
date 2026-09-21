# Event Catalog

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

The full verified event list from
[`../provider-boundary/razorpay-facts.md`](../provider-boundary/razorpay-facts.md#webhooks), and how
Kizunia treats each.

---

## State-changing events (trigger an authoritative refetch)

| Event | Kizunia treatment |
| --- | --- |
| `subscription.authenticated` | Refetch; typically the start of `TRIALING` or the pre-`active` moment |
| `subscription.activated` | Refetch; covers `TRIALING → ACTIVE`, `PENDING → ACTIVE`, and `HALTED → ACTIVE` (recovery) |
| `subscription.pending` | Refetch (confirms phase; no access change per [SB-PF-02](../../../project/feature-specification/subscription/decisions/payment-failure-and-recovery.md#sb-pf-02--pending-retains-full-paid-access)) |
| `subscription.halted` | Refetch; access ends per [SB-PF-03](../../../project/feature-specification/subscription/decisions/payment-failure-and-recovery.md#sb-pf-03--halted-ends-paid-access-but-never-cancels-the-subscription) |
| `subscription.cancelled` | Refetch; access ends (immediately or was already scheduled) |
| `subscription.completed` | Refetch; terminal, access ends |
| `subscription.paused` / `subscription.resumed` | Refetch; access ends / resumes accordingly |
| `subscription.updated` | Refetch; usually a scheduled-change notice (`has_scheduled_changes`), not an immediate access change — see [`../lifecycle/upgrade-downgrade.md`](../lifecycle/upgrade-downgrade.md) |

See [`ordering-and-staleness.md`](ordering-and-staleness.md) for why the payload's own status is not
applied directly even for these.

## Fact events (recorded append-only, never drive a state transition by themselves)

| Event | Kizunia treatment |
| --- | --- |
| `subscription.charged` | Recorded as a `BillingEvent`/charge fact, keyed by its own payment/invoice id — see [SB-WH-04](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-04--charges-are-recorded-as-append-only-facts-separate-from-current-state) |
| `payment.authorized` / `payment.captured` / `payment.failed` | Recorded the same way; a `payment.failed` immediately followed by `payment.captured` (a documented Razorpay possibility, e.g. late UPI authorization) is expected and both are simply recorded — this is exactly why these never drive state on their own |
| `order.paid` | Recorded; relevant primarily for any future one-time-purchase flow, not the subscription lifecycle |

## Unknown or unsupported events

Any event type not in this table is still verified, persisted (so nothing is silently dropped), and
marked `SKIPPED_UNSUPPORTED` rather than causing the endpoint to error. Razorpay adding a new event
type in the future must never turn into a webhook processing failure — see
[`reliability-and-idempotency.md`](reliability-and-idempotency.md).
