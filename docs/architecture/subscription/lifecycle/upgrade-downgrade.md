# Plan Changes (Upgrade / Downgrade)

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24 (extensibility section added by the decision close-out; earlier: rewritten around Razorpay's native capability — see
> [R-06](../../../project/feature-specification/subscription/decisions/reconciliations.md#r-06--the-update-api-does-not-support-plan-changes-for-most-indian-payment-methods))

Rulings: [SB-LC-02](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-02--upgrades-are-immediate),
[SB-LC-03](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-03--downgrades-take-effect-at-cycle-end),
[SB-LC-07](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-07--razorpay-decides-whether-a-plan-change-is-possible),
[SB-LC-08](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-08--at-most-one-scheduled-change-and-cancellation-always-wins).

---

## Which changes are plan changes

| User intent | What it actually is | Supported for |
| --- | --- | --- |
| Free → Pro / Pro+ | **Creation** — [`../commands/checkout-and-creation.md`](../commands/checkout-and-creation.md) | Every payment method |
| Pro / Pro+ → Free | **Cycle-end cancellation** — [`cancellation.md`](cancellation.md) | Every payment method |
| Pro → Pro+, or Monthly → Yearly at a higher price | **Upgrade** — native Update, `schedule_change_at: now` | Only subscriptions Razorpay can update |
| Pro+ → Pro, or Yearly → Monthly at a lower price | **Downgrade** — native Update, `schedule_change_at: cycle_end` | Only subscriptions Razorpay can update |

**FACT.** Razorpay updates only `authenticated`/`active` subscriptions, refuses updates when the
payment mode is UPI or e-mandate, and allows domestic-card subscriptions to change only their Offer
([razorpay-facts](../provider-boundary/razorpay-facts.md#upgrade--downgrade)). Paid→paid changes are
therefore available in practice for international-card subscriptions. For everyone else they are a
documented V1 limitation ([SB-LC-07](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-07--razorpay-decides-whether-a-plan-change-is-possible),
[B1, resolved for V1 on 2026-09-24](../../../project/feature-specification/subscription/open-decisions.md#b-resolved)).

## Capability: advisory in the UI, authoritative at Razorpay

- **Advisory.** When a Subscription is first synchronized after authentication, the boundary fetches
  the authorization payment and stores its method (`upi`, `emandate`, `card`) and, for cards,
  whether the card is international. The UI uses it to present the change as available or to
  explain in advance why it is not. The value is refreshed when a sync shows the subscription
  recovered from `HALTED` (the customer may have switched to a card).
- **Authoritative.** The Update call. A refusal is `REJECTED`, changes nothing, and is shown as
  "this plan change isn't available for your subscription". It is never retried and never worked
  around. If the advisory value said "possible" and Razorpay refused, the stored value is
  corrected from the refusal.

## Upgrade — immediate, Razorpay-prorated

```text
command CHANGE_PLAN(target plan, cycle)       -- preconditions: phase ACTIVE or TRIALING,
                                              -- no open anomaly, target > current
  [if a scheduled change is pending: child CANCEL_SCHEDULED_CHANGE, confirmed by sync]
  child UPDATE_PLAN: update(sub, { plan_id: target, schedule_change_at: "now" })
    Razorpay invoices and charges the prorated difference
      - charge succeeds  -> subscription updated; subscription.updated webhook
      - charge fails     -> "the Subscription is not updated" (FACT)
    Response applied through the guarded apply path; subscription marked sync-due
  Access to the higher plan begins when a sync shows the new plan_id.
```

No access is granted on the strength of the request. The user sees "upgrading…" until the new plan
is observed, typically within the same request.

## Downgrade — at cycle end, Razorpay-native

```text
command CHANGE_PLAN(lower plan)               -- preconditions: phase ACTIVE, target < current
  [if a scheduled change is pending: child CANCEL_SCHEDULED_CHANGE first]
  child UPDATE_PLAN: update(sub, { plan_id: target, schedule_change_at: "cycle_end" })
    Razorpay sets has_scheduled_changes = true
  The pending change is mirrored on the Subscription (target plan, effective at current_end) and
  shown to the user. Access is unchanged until then.
  At current_end Razorpay applies it. No webhook is documented for that moment (OPEN, A3), so the
  checkpoint sync at current_end + margin observes the new plan and updates access.
```

`cycle_end` is used for every downgrade, not only those Razorpay forces to cycle end (subscriptions
with an active Offer): it avoids Razorpay's credit-note refund path and keeps one behavior for all
downgrades ([SB-LC-03](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-03--downgrades-take-effect-at-cycle-end)).

## Races and edge cases

| Situation | Behavior |
| --- | --- |
| Two plan-change requests (tabs) | One in-flight operation per user; the second is refused or returns the first ([`../commands/operation-model.md`](../commands/operation-model.md)) |
| Upgrade while a downgrade is scheduled | The scheduled downgrade is cancelled first (Cancel an Update), then the upgrade is sent |
| Cancellation while a downgrade is scheduled | The scheduled change is cancelled first; the subscription ends at cycle end on its current plan ([SB-LC-08](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-08--at-most-one-scheduled-change-and-cancellation-always-wins)) |
| Plan change after a cycle-end cancellation was requested | Refused: the subscription is ending; the user can buy the new plan after it ends |
| Webhook arrives before the Update response | Both are observations; the stale-apply guard orders them |
| Update response lost (timeout) | `OUTCOME_UNKNOWN`; the next sync shows whether the plan (or a pending change) moved; not re-sent automatically |
| Razorpay: "another subscription operation is in progress" | `CONCURRENT_OPERATION`; nothing changes; the user may retry shortly |
| Proration difference below ₹0.5 | Razorpay rejects; shown as "this change can't be made right now" ([FACT](../provider-boundary/razorpay-facts.md#upgrade--downgrade)) |
| Subscription `PAST_DUE` / `HALTED` / `PAUSED` / not authenticated | Refused locally (Razorpay would refuse too) |
| Dashboard operator changes the plan | Observed by `subscription.updated` or the next checkpoint/heartbeat; applied like any change; history cause `provider_observed` |
| Dashboard change to a plan ID not in the catalog | Not applied; `UNMAPPED_PROVIDER_PLAN` ([SB-PB-05](../../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-05--provider-plan-ids-map-to-kizunia-plans-through-a-per-mode-catalog-many-to-one)) |
| Upgrade with an active Offer | Sent as usual; Razorpay's handling of the Offer across an upgrade is not documented — whatever state results is observed and applied |

## Extensibility: a later switch flow

**Decided 2026-09-24** ([IB-21](../implementation/open-decisions.md#ib-21--plan-change-extensibility)).

*Product decision (owner):* V1 keeps [SB-LC-07](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-07--razorpay-decides-whether-a-plan-change-is-possible).
UPI, the dominant rail, cannot be updated natively, so for most customers paid→paid changes remain the
documented limitation. A switch/successor flow is **deferred**, and the V1 design must let it be added
later without restructuring.

*Architecture decision (autonomous):* that is guaranteed by five seams, all built in V1 with no extra
behavior:

| Seam | V1 | What a later switch adds |
| --- | --- | --- |
| **Plan-change strategy.** `ChangePlan` asks one pure policy which strategy applies to (subscription, target) | `NATIVE_UPDATE` or `UNAVAILABLE` (the UI explains the limitation) | A `SWITCH` strategy branch with its own child operations; the runner, controllers and callers are unchanged |
| **Open-subscription precondition.** "Kizunia never creates a second open subscription" ([SB-UQ-02](../../../project/feature-specification/subscription/decisions/uniqueness-and-resubscription.md#sb-uq-02--kizunia-never-creates-a-second-open-subscription-for-a-user)) is evaluated in one policy function | Refuses any second open subscription | A relaxation for a *retiring, linked* predecessor is a change to that function only, plus a new ruling |
| **Successor link.** `Subscription.supersededById` | Written by supersession | Reused for a switch; a replacement *reason* column or enum is additive |
| **Operation kinds.** `CHANGE_PLAN` is a root kind | Children `CANCEL_SCHEDULED_CHANGE`, `UPDATE_PLAN` | Children `CANCEL_AT_CYCLE_END`, `CREATE_SUBSCRIPTION` already exist |
| **Provider boundary** | create (with optional `startAt`), cancel (cycle-end or immediate), update, cancel scheduled change | Nothing new |

The product decisions a switch still needs (partial-period pricing, a second mandate, the invariant
relaxation) are listed in
[`future.md`](../../../project/feature-specification/subscription/future.md#plan-changes-razorpay-cannot-perform-natively).

## What is not built

- A successor-subscription workaround for payment methods Razorpay cannot update.
- Kizunia-computed proration, credits or refunds.
- Granting the higher plan before Razorpay reports it.

All three are deliberate ([SB-LC-07](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-07--razorpay-decides-whether-a-plan-change-is-possible)).
See [`../../../project/feature-specification/subscription/future.md`](../../../project/feature-specification/subscription/future.md#plan-changes-razorpay-cannot-perform-natively).
