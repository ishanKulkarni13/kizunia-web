# Subscription History

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24

---

## What is recorded

A `SubscriptionHistoryEntry` for every **access-relevant change** to a Subscription, written in the
same transaction as the change (the sync apply path, or a local-only transition such as
`ABANDONED`):

| Recorded change | Example |
| --- | --- |
| Phase transition | `ACTIVE → PAST_DUE` |
| Plan or cycle change | `PRO → PRO_PLUS` (immediate upgrade observed) |
| Scheduled change set or cleared | "downgrade to PRO at 2026-11-01 requested", "scheduled change cancelled" |
| Cycle-end cancellation requested | `cancelAtPeriodEnd` set by operation X |
| Provider ID bound | `PROVISIONING → PENDING_AUTHENTICATION`, bound via orphan discovery |
| Supersession | `HALTED → CANCELLED`, `supersededBy` = new Subscription |

```text
SubscriptionHistoryEntry {
  subscriptionId, userId,
  change:        phase | plan | scheduled_change | cancel_at_period_end | binding | supersession
  from, to,
  cause:         kizunia_command | provider_observed | local
  trigger:       webhook | checkout_confirm | command_response | command_confirm |
                 checkpoint | heartbeat | retry | orphan_discovery | admin_sync | system
  operationId?   -- the BillingOperation this settles (cause = kizunia_command)
  eventId?       -- the BillingEvent whose sync this was (trigger = webhook)
  actor?         -- user or admin, when cause = kizunia_command or admin_sync
  observationAt  -- the provider request send time the change was derived from
  recordedAt
}
```

**Cause** answers "who changed it": Kizunia (the observation settles a Kizunia `BillingOperation`),
Razorpay-side (Dashboard, customer's UPI app, Razorpay's own lifecycle), or a local-only resolution.
**Trigger** answers "how did Kizunia find out". The earlier `webhook | admin | reconciliation` enum
conflated the two, and could not say whether a cancellation observed by reconciliation was a
Kizunia command or a Dashboard action
([SB-RC-03 note](../../../project/feature-specification/subscription/decisions/reconciliation.md#sb-rc-03--reconciliation-corrections-are-applied-transactionally-and-recorded-in-history)).

## The billing records, and what each answers

| Record | Is | Answers |
| --- | --- | --- |
| `BillingEvent` | Every verified webhook, as received | "Did Razorpay tell us? When? Did we receive it twice?" |
| `BillingOperation` | Every mutation Kizunia attempted | "Did *we* ask Razorpay to do this? Did it work? Is it still unknown?" |
| `SubscriptionHistoryEntry` | Every access-relevant change Kizunia applied | "What changed, when, why, and who caused it?" |
| Charge / refund / dispute facts | Money movements Razorpay reported | "Was the user charged? Refunded?" |
| Sync fields on `Subscription` | Current sync health | "When did we last successfully check? Is a check overdue? What failed?" |
| Grant audit ([`admin-grant-audit.md`](admin-grant-audit.md)) | Every grant action | "Who gave this access, and why?" |
| Anomalies | Situations needing a human | "Are there duplicate/unmatched subscriptions, unmapped plans, mode mismatches?" |

`SubscriptionHistoryEntry` is not derived by replaying `BillingEvent`s: it records what Kizunia
*decided*, including changes no webhook reported (reconciliation, orphan binding) and decisions made
under logic that may later change.

## A worked example

```text
Subscription S1 (user U)
  binding     PROVISIONING -> PENDING_AUTHENTICATION  kizunia_command / command_response  op#1 (create)
  phase       PENDING_AUTHENTICATION -> TRIALING      provider_observed / checkout_confirm
  phase       TRIALING -> ACTIVE                      provider_observed / webhook  evt#… (activated)
  plan        PRO -> PRO_PLUS                         kizunia_command / command_response  op#2 (upgrade)
  phase       ACTIVE -> PAST_DUE                      provider_observed / webhook  (pending)
  phase       PAST_DUE -> HALTED                      provider_observed / checkpoint  (webhook missed)
  supersession HALTED -> CANCELLED                    kizunia_command / command_confirm  op#3 (supersede)
Subscription S2 (user U), supersedes S1
  binding     PROVISIONING -> PENDING_AUTHENTICATION  kizunia_command / command_response  op#4
  phase       PENDING_AUTHENTICATION -> ACTIVE        provider_observed / webhook
  phase       ACTIVE -> CANCELLED                     provider_observed / webhook  (Dashboard cancellation)
```

Together with the user's grants, this reconstructs "Free → Pro trial → Pro → Pro+ → Free → Pro+ →
Free" end to end, including which steps Kizunia caused.

## Retention

History entries, operations and money facts are never pruned; on account removal they are
pseudonymized, not deleted ([SB-DP-04](../../../project/feature-specification/subscription/decisions/data-preservation.md#sb-dp-04--billing-records-survive-account-removal)).
Raw webhook payloads inside `BillingEvent` are **nulled** after the payload retention horizon
(`billing:payload-prune`, 180 days by default; `payloadPrunedAt` is stamped); the event row (ID, type,
timestamps, linkage) remains and is never deleted. Final retention periods are open product question
[B3](../../../project/feature-specification/subscription/open-decisions.md#b-genuinely-open-product-questions).
