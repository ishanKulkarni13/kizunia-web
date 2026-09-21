# Subscription History

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

---

## What is recorded

Every `Subscription.phase` transition, as a `SubscriptionHistoryEntry`:
`{ subscriptionId, fromPhase, toPhase, cause: webhook | admin | reconciliation, triggeringReference,
timestamp }`. See [`../../domain/subscription/entities.md`](../../domain/subscription/entities.md#subscriptionhistoryentry).

## Why it exists as its own record, not derived from `BillingEvent`

`BillingEvent` records what Razorpay *sent*; `SubscriptionHistoryEntry` records what Kizunia
*decided* as a result — including corrections made by reconciliation, which have no corresponding
inbound webhook at all. Answering "why does this user have this access" by replaying every
`BillingEvent` and re-deriving the logic that was applied at the time would be fragile if that logic
ever changes; a direct, already-decided history entry is not.

## A worked example

```text
SubscriptionHistoryEntry log for one Subscription:
  PENDING_AUTHENTICATION -> TRIALING     cause: webhook (subscription.authenticated)
  TRIALING -> ACTIVE                     cause: webhook (subscription.activated)
  ACTIVE -> ACTIVE (plan PRO -> PRO_PLUS) cause: webhook (subscription.charged, upgrade)
  ACTIVE -> HALTED                       cause: webhook (subscription.halted)
  HALTED -> ACTIVE                       cause: webhook (subscription.activated, recovery)
  ACTIVE -> CANCELLED                    cause: webhook (subscription.cancelled — Dashboard-originated)
```

Combined with the user's `EntitlementGrant` history (covered separately in
[`admin-grant-audit.md`](admin-grant-audit.md)), this fully answers the product requirement to
reconstruct a chain like "Free → Pro Trial → Pro → Pro+ → Pro → Free" end to end.

## Retention

Never pruned. Unlike notification delivery records (which the notification subsystem prunes on a
retention horizon for storage reasons), subscription history is exactly the kind of record whose
value is in staying complete indefinitely — it is financial/audit history, not operational
delivery-tracking data.
