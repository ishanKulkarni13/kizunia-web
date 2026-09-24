# Lifecycle

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24

How Razorpay's subscription lifecycle becomes Kizunia's own, and how each transition — trial, plan
change, cancellation, payment failure, provider-side change, resubscription — is handled.

| Document | Contents |
| --- | --- |
| [`state-mapping.md`](state-mapping.md) | Razorpay states → Kizunia phases; open, contributing and terminal phases |
| [`multiple-subscriptions.md`](multiple-subscriptions.md) | The open-subscription invariant, supersession of halted subscriptions, detection of duplicates |
| [`trials.md`](trials.md) | Razorpay-native trial only; one trial per account |
| [`upgrade-downgrade.md`](upgrade-downgrade.md) | Native plan changes where Razorpay supports them; the V1 limitation where it does not |
| [`cancellation.md`](cancellation.md) | Cycle-end default, immediate during a trial, while a payment is failing (`PAST_DUE`, decided 2026-09-24) and for admins, no undo |
| [`payment-failure-and-recovery.md`](payment-failure-and-recovery.md) | `PAST_DUE`, `HALTED`, recovery — no second retry engine |
| [`dashboard-originated-changes.md`](dashboard-originated-changes.md) | Dashboard- and customer-originated changes, traced end to end |

Product behavior is stated in
[`../../../project/feature-specification/subscription/subscription-lifecycle.md`](../../../project/feature-specification/subscription/subscription-lifecycle.md);
this section covers mechanism only. Every change Kizunia *initiates* is a command
([`../commands/`](../commands/README.md)); every change it *observes* arrives through the
[sync mechanism](../reconciliation/sync-mechanism.md).
