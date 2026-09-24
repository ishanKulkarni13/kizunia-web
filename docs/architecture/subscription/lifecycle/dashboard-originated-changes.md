# Provider-Side Changes (Dashboard and Customer)

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24

A subscription can change without Kizunia asking: a Razorpay Dashboard operator can cancel, pause,
resume, update, link an Offer or issue a refund; a UPI AutoPay customer can cancel or pause their
mandate from their UPI app. See
[SB-LC-06](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-06--a-dashboard-originated-change-is-a-normal-lifecycle-path)
and the underlying [FACT](../provider-boundary/razorpay-facts.md#payment-methods-and-customer-originated-changes).

---

## Traced end-to-end

```text
Operator cancels a subscription in the Razorpay Dashboard  (or: customer revokes the UPI mandate)
  -> Razorpay's subscription state changes to `cancelled`
  -> Razorpay sends subscription.cancelled
  -> Kizunia verifies the signature, records the event, marks the Subscription sync-due (one tx), 2xx
  -> after(): authoritative fetch -> guarded apply -> phase = CANCELLED
  -> SubscriptionHistoryEntry: cause = provider_observed, trigger = webhook, event id
  -> effective access (computed on read) no longer includes the plan
```

If the webhook is missed, the next checkpoint or heartbeat sync observes the same state
([`../reconciliation/reconciliation-job.md`](../reconciliation/reconciliation-job.md)).

The pipeline is identical to a Kizunia-initiated change — no branch, flag or special case.

## Attribution

Kizunia cannot tell a Dashboard operator from a customer's UPI app, and it does not try. A history
entry is attributed to Kizunia (`cause = kizunia_command`, linked to the `BillingOperation`) only
when the observation settles an operation Kizunia issued; otherwise it is `provider_observed`. This
is what lets support answer "did we do this, or did it happen at Razorpay?"
([`../history-and-audit/subscription-history.md`](../history-and-audit/subscription-history.md)).

## Every Dashboard action, and what Kizunia does

| Provider-side action | Kizunia |
| --- | --- |
| Cancel (immediate or cycle end) | Observed and applied; a cycle-end cancel is invisible until it takes effect (verified in TEST mode 2026-09-24: no entity field changes, [A2](../../../project/feature-specification/subscription/open-decisions.md#a-resolved-answered-by-test-verification-2026-09-24)) |
| Pause / resume | `PAUSED` (no access) / `ACTIVE` |
| Update plan / quantity | Applied if the plan ID is in the catalog; otherwise not applied, `UNMAPPED_PROVIDER_PLAN` |
| Link an Offer | Observed (`offer_id`); billing only, no access effect |
| Refund | Refund fact recorded; access unaffected; a cancellation, if also performed, arrives as its own event |
| Create a subscription / Subscription Link | Unmatched unless its `notes` name a Kizunia record; `UNMATCHED_PROVIDER_SUBSCRIPTION` — V1 does not grant access through Dashboard-created subscriptions ([SB-WH-06](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-06--events-for-unknown-subscriptions-are-persisted-and-matched-never-dropped)) |
| Bulk operation on many subscriptions | Each event marks one Subscription; syncs drain within the request budget ([`../reconciliation/provider-rate-limits.md`](../reconciliation/provider-rate-limits.md#webhook-storms-and-bulk-dashboard-actions)) |

## Why this must not be an afterthought

Designing only for Kizunia-initiated mutations would mean the webhook handler is only ever exercised
by traffic Kizunia's own code generated. Because Dashboard operations are an intended part of how
Kizunia operates, and customer-side mandate changes are outside anyone's control, this path is
exercised by the same tests and code as every other change.

## Operators must know what Kizunia will not do

The runbook ([`../cross-cutting/operations-runbook.md`](../cross-cutting/operations-runbook.md))
states the rules for operators: prefer Kizunia's admin commands (they are recorded and attributed);
use the Dashboard for refunds and for what Kizunia does not expose; never create subscriptions in the
Dashboard to give someone access (use an admin grant).
