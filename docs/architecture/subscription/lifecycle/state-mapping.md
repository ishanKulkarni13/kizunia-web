# State Mapping

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

Razorpay's 9 documented states (see
[`../provider-boundary/razorpay-facts.md`](../provider-boundary/razorpay-facts.md#lifecycle-states))
mapped to Kizunia's own `Subscription.phase` vocabulary.

---

## The mapping

| Razorpay state | Kizunia phase | Contributes to effective access? |
| --- | --- | --- |
| `created` | `PENDING_AUTHENTICATION` | No |
| `authenticated`, `start_at` in the future | `TRIALING` | Yes — the trial's plan |
| `authenticated`, `start_at` reached/absent | `PENDING_AUTHENTICATION` (transitional; Razorpay moves this to `active` on first charge) | No |
| `active` | `ACTIVE` | Yes — the subscribed plan |
| `pending` | `ACTIVE` (unchanged — see [SB-PF-02](../../../project/feature-specification/subscription/decisions/payment-failure-and-recovery.md#sb-pf-02--pending-retains-full-paid-access)) | Yes |
| `halted` | `HALTED` | **No** — see [SB-PF-03](../../../project/feature-specification/subscription/decisions/payment-failure-and-recovery.md#sb-pf-03--halted-ends-paid-access-but-never-cancels-the-subscription) |
| `paused` | `PAUSED` | No |
| `cancelled` | `CANCELLED` | No — terminal |
| `expired` | `EXPIRED` | No — terminal |
| `completed` | `COMPLETED` | No — terminal |

A phase's "contributes to effective access" column is exactly the input
[`../entitlements/effective-access-resolution.md`](../entitlements/effective-access-resolution.md)
reads.

## Why `pending` keeps `ACTIVE` as its Kizunia phase

Introducing a distinct Kizunia phase for `pending` (e.g. `GRACE`) was considered and rejected: the
only decision effective-access resolution needs to make is "does this still contribute," and
`pending`'s answer is unconditionally yes. A separate phase would exist only to be treated
identically to `ACTIVE` everywhere it is read, which is not a distinction worth carrying — though
`pending` is still recorded faithfully in the underlying `SubscriptionHistoryEntry`/`BillingEvent`
trail for observability, exactly as Razorpay reported it.

## Terminal states are still visible in history

Reaching `CANCELLED`, `EXPIRED`, or `COMPLETED` does not delete the `Subscription` record. It stops
contributing to effective access; its full transition history remains — see
[`../history-and-audit/subscription-history.md`](../history-and-audit/subscription-history.md).

## What triggers a re-evaluation of this mapping

Every state-changing webhook event, after the [authoritative refetch](../webhooks/ordering-and-staleness.md), and every
[reconciliation](../reconciliation/README.md) pass.
