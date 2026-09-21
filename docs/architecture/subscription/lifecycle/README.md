# Lifecycle

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

How Razorpay's subscription lifecycle becomes Kizunia's own, and how each transition — trial,
upgrade, downgrade, cancellation, payment failure, and Dashboard-originated change — is handled.

| Document | Contents |
| --- | --- |
| [`state-mapping.md`](state-mapping.md) | Razorpay's 9 states → Kizunia's internal phases |
| [`trials.md`](trials.md) | Razorpay-native trial only |
| [`upgrade-downgrade.md`](upgrade-downgrade.md) | Immediate upgrade, cycle-end downgrade |
| [`cancellation.md`](cancellation.md) | Cycle-end default, immediate as an explicit action |
| [`payment-failure-and-recovery.md`](payment-failure-and-recovery.md) | Why there is no second retry engine |
| [`dashboard-originated-changes.md`](dashboard-originated-changes.md) | Why an admin's Dashboard action is a normal path, traced end-to-end |

Product behavior is stated in
[`../../../project/feature-specification/subscription/subscription-lifecycle.md`](../../../project/feature-specification/subscription/subscription-lifecycle.md);
this section covers mechanism only.
