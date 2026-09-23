# Subscription Domain — Overview

> **Status:** Design — conceptual, not a schema
>
> **Last Updated:** 2026-09-24

```text
Plan                     — a fixed catalog entry (FREE / PRO / PRO_PLUS x MONTHLY / YEARLY)
Subscription             — one Razorpay subscription for its whole life, in Kizunia's vocabulary,
                           with its own sync state
EntitlementGrant         — a non-billing entitlement source (admin grant, promotion)
BillingOperation         — every mutation Kizunia asked Razorpay to perform, and its outcome
BillingEvent             — every received, verified webhook event
Charge/refund/dispute    — append-only money facts Razorpay reported
SubscriptionHistoryEntry — every access-relevant change to a Subscription, with cause and trigger
BillingAnomaly           — a detected situation deliberately left for a human
ProviderReference        — the opaque Razorpay identifiers attached to a Subscription
EffectiveAccess          — computed, not stored: the highest currently valid tier across all sources
```

No entity models "Free" directly — Free is the absence of any contributing Subscription or valid
grant ([SB-EA-01](../../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-01--free-has-no-subscription-record)).
A trial is a Subscription of kind `TRIAL`, not a grant.

## What changed on 2026-09-24

The first version of this model had one long-lived Subscription per user whose Razorpay reference
was swapped on resubscribe, one "active" Subscription as an invariant, and no record of what Kizunia
itself asked Razorpay to do. An adversarial review found that this could not represent a recovered
halted subscription alongside a new one, could not recover from a lost create response, and could not
answer "did we do this?". The model now has one Subscription per Razorpay subscription
([SB-UQ-01](../../../project/feature-specification/subscription/decisions/uniqueness-and-resubscription.md#sb-uq-01--a-subscription-is-one-razorpay-subscription-bound-once)),
an open-subscription invariant enforced at creation
([SB-UQ-02](../../../project/feature-specification/subscription/decisions/uniqueness-and-resubscription.md#sb-uq-02--kizunia-never-creates-a-second-open-subscription-for-a-user)),
and `BillingOperation` ([SB-CM-01](../../../project/feature-specification/subscription/decisions/commands-and-idempotency.md#sb-cm-01--every-mutating-provider-call-is-a-recorded-billing-operation)).
See [R-04](../../../project/feature-specification/subscription/decisions/reconciliations.md#r-04--one-active-subscription-per-user-versus-preserving-halted-subscriptions).

## Why storage shape is deliberately absent

Several shaping decisions remain open at the implementation level (whether facts share a table, how
`ProviderReference` is stored, retention mechanics) — decisions the notification subsystem's own
`domain/notifications/` resolved the same way: describe each entity's *contract*, defer the schema.
The constraints that are not optional are listed in
[`relationships.md`](relationships.md#storage-is-an-implementation-phase-decision).

## Why Subscription and EntitlementGrant are two entities, not one polymorphic table

A single `AccessGrant`-style table with a `source` enum covering
`PAID_SUBSCRIPTION | ADMIN_GRANT | TRIAL | PROMOTION` is rejected: a paid Subscription carries
Razorpay-lifecycle-shaped state (billing period, phase, provider reference, sync state, operations,
history) that a grant never has. Forcing them into one shape would mean a table of columns that are
`NULL` for every non-billing row, or a JSON blob doing the real work. Effective-access resolution reads
both and takes the maximum; it does not need them to share a table.
