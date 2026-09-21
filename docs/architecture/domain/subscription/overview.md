# Subscription Domain — Overview

> **Status:** Design — conceptual, not a schema
>
> **Last Updated:** 2026-09-21

```text
Plan                — a fixed catalog entry (FREE / PRO / PRO_PLUS x MONTHLY / YEARLY)
Subscription         — one user's paid billing relationship, with a lifecycle and a Razorpay reference
EntitlementGrant      — a non-billing entitlement source (admin grant, trial, promotion)
EffectiveAccess       — computed, not stored: the highest currently valid tier across all sources
BillingEvent          — an append-only record of every received, verified webhook event
SubscriptionHistoryEntry — an append-only record of every Subscription state transition, with cause
ProviderReference     — the opaque Razorpay identifiers attached to a Subscription
```

Six persisted concepts and one computed one. No entity here models "Free" directly — Free is the
absence of a currently valid Subscription or EntitlementGrant, per
[SB-EA-01](../../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-01--free-has-no-subscription-record).

## Why storage shape is deliberately absent

Several shaping decisions remain genuinely open at the implementation level (exact retention for
`BillingEvent`, whether `SubscriptionHistoryEntry` is one table or a per-transition-type set,
whether `ProviderReference` is a JSON field or a related table) — decisions the notification
subsystem's own `domain/notifications/` faced and resolved the same way: describe the entity's
*contract*, defer the schema. A guessed schema, written before those questions are answered, is
harder to remove than to write. See [`entities.md`](entities.md).

## Why Subscription and EntitlementGrant are two entities, not one polymorphic table

A tempting alternative is a single `AccessGrant`-style table with a `source` enum covering
`PAID_SUBSCRIPTION | ADMIN_GRANT | TRIAL | PROMOTION`. It is rejected: a paid Subscription carries
meaningfully richer, Razorpay-lifecycle-shaped state (current billing period, retry/halted phase, a
provider reference, a full history of billing transitions) that a grant or promotion simply does not
have and never will. Forcing them into one shape would mean either a table full of columns that are
`NULL` for every non-billing row, or a JSON blob doing the real work — both worse than two small,
honest entities. Effective-access resolution reads both and takes the maximum; it does not require
them to share a table. See [`relationships.md`](relationships.md).
