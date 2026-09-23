# Event Catalog

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24

The verified event list from
[`../provider-boundary/razorpay-facts.md`](../provider-boundary/razorpay-facts.md#webhooks), and how
Kizunia treats each. Which events are subscribed at all: [SB-WH-08](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-08--kizunia-subscribes-only-to-the-events-it-acts-on).

---

## Subscription events (mark the Subscription sync-due)

No subscription event's payload status is ever applied. Each one only marks its Subscription
sync-due; the resulting phase comes from the authoritative fetch
([`ordering-and-staleness.md`](ordering-and-staleness.md)). The "typical outcome" column is what the
fetch usually shows, for orientation only.

| Event | Typical outcome after sync |
| --- | --- |
| `subscription.authenticated` | `TRIALING` (kind `TRIAL`) or a transitional non-contributing state (kind `STANDARD`, until `active`) |
| `subscription.activated` | `ACTIVE` — first activation, trial conversion, `pending → active`, or `halted → active` recovery |
| `subscription.charged` | Usually unchanged phase; new period. **Also** records a charge fact (below) |
| `subscription.pending` | `PAST_DUE` (still contributes — [SB-PF-02](../../../project/feature-specification/subscription/decisions/payment-failure-and-recovery.md#sb-pf-02--pending-retains-full-paid-access)) |
| `subscription.halted` | `HALTED` (access ends — [SB-PF-03](../../../project/feature-specification/subscription/decisions/payment-failure-and-recovery.md#sb-pf-03--halted-ends-paid-access-but-never-cancels-the-subscription)) |
| `subscription.cancelled` | `CANCELLED` (Kizunia-, Dashboard- or UPI-app-originated) |
| `subscription.completed` | `COMPLETED` |
| `subscription.paused` / `subscription.resumed` | `PAUSED` / `ACTIVE` |
| `subscription.updated` | New plan (immediate update) or refreshed scheduled-change state |

**Not covered by any documented event:** a *requested* cycle-end cancellation, a *requested*
`cycle_end` plan change, and the moment a scheduled change is *applied*. Kizunia learns the first two
from its own `BillingOperation` (when it issued them) and observes the third by due-based
reconciliation at the scheduled time
([`../reconciliation/reconciliation-job.md`](../reconciliation/reconciliation-job.md)).

## Fact events (recorded append-only; never drive state)

| Event | Kizunia treatment |
| --- | --- |
| `subscription.charged` | Charge fact keyed by payment id: amount, invoice id, period — plus the sync mark above ([SB-WH-04](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-04--charges-are-recorded-as-append-only-facts-separate-from-current-state)) |
| `refund.processed` | Refund fact keyed by refund id; never changes access by itself |
| `payment.dispute.created` | Dispute fact; raises a support alert; never changes access by itself |

`payment.authorized`/`captured`/`failed`, `order.paid` and `invoice.*` are not subscribed
([SB-WH-08](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-08--kizunia-subscribes-only-to-the-events-it-acts-on)).

## Events for subscriptions Kizunia does not know

Recorded, then matched through `notes` or flagged `UNMATCHED` —
[SB-WH-06](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-06--events-for-unknown-subscriptions-are-persisted-and-matched-never-dropped),
[`reliability-and-idempotency.md`](reliability-and-idempotency.md#the-pipeline).

## Unknown or unsupported events

Any event type not in this table is still verified, recorded (nothing is silently dropped), and
marked `SKIPPED_UNSUPPORTED`. Razorpay adding a new event type never becomes a webhook failure.
