# Outage and Stale State

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

A temporary Razorpay outage, in `live` or `test` mode, must never automatically revoke access. This
is different from [`disabled-provider-mode.md`](disabled-provider-mode.md): the provider is
configured and normally reachable, just temporarily not responding.

---

## What happens

Kizunia's local `Subscription`/`EntitlementGrant` state is the only thing effective-access
resolution ever reads ([`../entitlements/effective-access-resolution.md`](../entitlements/effective-access-resolution.md)) —
it is never itself a live Razorpay call. A Razorpay outage therefore has **no direct effect** on
effective access for any user whose local state is already correct.

What an outage *does* affect:

| Affected | Behavior during outage |
| --- | --- |
| New subscription creation, plan changes, cancellation | Fail cleanly with a clear "billing temporarily unavailable, try again shortly" response — the same shape as [`disabled-provider-mode.md`](disabled-provider-mode.md)'s user-facing behavior, for a different underlying reason |
| Webhook processing that requires an authoritative refetch | Fails per [`../webhooks/ordering-and-staleness.md`](../webhooks/ordering-and-staleness.md); retried on the existing backoff; the local state is left as it was, not guessed at |
| The periodic reconciliation sweep | Skips the unreachable subscriptions for this pass per [`../reconciliation/reconciliation-job.md`](../reconciliation/reconciliation-job.md#if-razorpay-is-unreachable-during-a-reconciliation-pass), retries next pass |

## How long stale state is trusted

Indefinitely, until either a webhook is successfully processed or reconciliation succeeds. There is
no timeout after which Kizunia gives up and demotes a user to Free "just in case" — doing so would
convert a provider-side availability problem into a Kizunia-caused access loss for a paying
customer, which is exactly the failure this design exists to prevent.

## Recovery

Once Razorpay is reachable again, the next reconciliation pass (or the next successfully processed
webhook, including a replay of one that failed earlier) brings local state back in sync with
whatever actually happened during the outage — no manual intervention is required for the common
case.
