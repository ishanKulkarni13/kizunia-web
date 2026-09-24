# Commands

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24

A **command** is anything Kizunia asks Razorpay to change. Webhooks and reconciliation cover what
Razorpay tells Kizunia ([`../reconciliation/`](../reconciliation/README.md)); this section covers the
opposite direction — the one that can double-bill a customer if it goes wrong.

| Document | Contents |
| --- | --- |
| [`operation-model.md`](operation-model.md) | `BillingOperation`, per-user serialization, idempotency keys, outcome-unknown resolution, the command catalog |
| [`checkout-and-creation.md`](checkout-and-creation.md) | Subscription creation end to end, checkout confirmation, and the failure matrix |

Rulings: [SB-CM-01 through SB-CM-06](../../../project/feature-specification/subscription/decisions/commands-and-idempotency.md),
[SB-UQ-01 through SB-UQ-05](../../../project/feature-specification/subscription/decisions/uniqueness-and-resubscription.md).

## The three rules every command follows

1. **Record before calling.** A durable `BillingOperation` (and, for creation, a `PROVISIONING`
   Subscription) is committed before any request leaves Kizunia.
2. **Never retry blindly.** A command whose outcome is unknown is resolved by *observing* Razorpay,
   not by sending it again.
3. **Apply the response like any other observation.** A command response goes through the same
   mapping and stale-apply guard as a sync ([`../reconciliation/sync-mechanism.md`](../reconciliation/sync-mechanism.md#applying-an-observation)).

## What is not a command

Synchronization, reconciliation and orphan discovery never mutate Razorpay
([SB-RC-10](../../../project/feature-specification/subscription/decisions/reconciliation.md#sb-rc-10--synchronization-only-reads-it-never-changes-provider-state)).
Admin grants and promotions never touch Razorpay at all
([`../entitlements/admin-grants.md`](../entitlements/admin-grants.md)). Neither goes through this
section.
