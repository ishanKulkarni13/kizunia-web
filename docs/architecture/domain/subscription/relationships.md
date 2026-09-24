# Subscription Domain — Relationships

> **Status:** Design — conceptual, not a schema
>
> **Last Updated:** 2026-09-24 (decision close-out: IB-6, IB-14)

```text
User 1 ────── 0..n  Subscription            (one per Razorpay subscription, ever; history across
                                              cancel -> resubscribe is simply several Subscriptions.
                                              Kizunia never creates a second OPEN one — see below)
User 1 ────── 0..n  EntitlementGrant         (multiple may be simultaneously valid)
User 1 ────── 0..n  BillingOperation         (at most one IN_FLIGHT *root* operation at a time)

Subscription 1 ──── 0..1  ProviderReference          (bound once, when Razorpay confirms creation)
Subscription 1 ──── 0..n  SubscriptionHistoryEntry   (append-only)
Subscription 1 ──── 0..n  BillingOperation           (the commands that targeted it)
Subscription 0..1 ─────── 0..n  BillingEvent          (an event concerns at most one Subscription)
Subscription 1 ──── 0..n  charge / refund / dispute facts
Subscription 0..1 ─────── 0..1  Subscription          (supersededBy)

EffectiveAccess(user, now) = max(tier)
  over { Subscription.plan : phase in {TRIALING, ACTIVE, PAST_DUE}
                             and providerMode = expected billing mode }
  ∪    { EntitlementGrant.plan : status = ACTIVE and now within validity window }
  default FREE
```

## Uniqueness, stated precisely

| Set | Cardinality per user | How it is guaranteed |
| --- | --- | --- |
| All Subscriptions | Unbounded (history) | — |
| **Open** Subscriptions (`PROVISIONING`, `PENDING_AUTHENTICATION`, `TRIALING`, `ACTIVE`, `PAST_DUE`, `PAUSED`, `HALTED`) | Kizunia creates at most one; more than one is an anomaly | Command-time check under the user's single in-flight operation; detection on every phase change ([`../../subscription/lifecycle/multiple-subscriptions.md`](../../subscription/lifecycle/multiple-subscriptions.md)) |
| **Contributing** Subscriptions (`TRIALING`, `ACTIVE`, `PAST_DUE`) | Normally ≤ 1 | Follows from the above; effective access takes the maximum regardless |
| Pending scheduled plan changes on one Subscription | ≤ 1 | [SB-LC-08](../../../project/feature-specification/subscription/decisions/lifecycle.md#sb-lc-08--at-most-one-scheduled-change-and-cancellation-always-wins) |
| `IN_FLIGHT` **root** BillingOperations (no parent) | ≤ 1 | Database constraint (partial unique index). Child operations of a composed command run under their root's slot ([IB-6](../../subscription/implementation/open-decisions.md#ib-6--composed-commands-and-the-in-flight-constraint), 2026-09-24; previously stated as "`IN_FLIGHT` BillingOperations ≤ 1", which would have blocked composed commands) |

## Boundaries with other domains

| Domain | Relationship |
| --- | --- |
| **User** | Owns Subscriptions, grants and operations. Billing never redefines identity. Billing records never cascade-delete with a user ([SB-DP-04](../../../project/feature-specification/subscription/decisions/data-preservation.md#sb-dp-04--billing-records-survive-account-removal)) |
| **Project** (`ProjectMember`) | Consumes effective access as a quota input — see [`../../subscription/entitlements/quotas-vs-rate-limits.md`](../../subscription/entitlements/quotas-vs-rate-limits.md) |
| **Portfolio** | Consumes effective access through `resolvePortfolioPublicEligibility()` — see [`../../subscription/entitlements/authorization-integration.md`](../../subscription/entitlements/authorization-integration.md) |
| **Notifications** | Consumes the set-based form of the effective-access rule in its scheduler, and the per-user form in handlers — see [`../notifications/README.md`](../notifications/README.md) and [`../../notifications/cross-cutting/feature-flags-and-entitlements.md`](../../notifications/cross-cutting/feature-flags-and-entitlements.md) |
| **Recommendations** | Same pattern as Notifications, at the recommendation-generation service |
| **MCP** | An additional check inside the existing `PlatformPolicy`/scope chain |
| **Authorization** (`AuthorizationEvaluator`) | Consumes effective access; does not merge with it — see [`../../../project/feature-specification/subscription/glossary.md`](../../../project/feature-specification/subscription/glossary.md#3-entitlement-vs-authorization) |
| **Rate limiting** | Consumes effective access for plan-tier overrides; separately hosts the outbound provider request budget's counters |
| **Internal jobs** | Runs the `billing-sync` and orphan-discovery tasks; knows nothing about billing |

## What this domain does not own

Authorization decisions, resource ownership, rate-limit policy, and notification/recommendation/MCP
business logic remain owned by their domains. This domain owns exactly: what plan a user's access
resolves to, why, and the record of every billing interaction with Razorpay that led there.

## Storage is an implementation-phase decision

These relationships describe cardinality and ownership, not tables or foreign keys. How
`ProviderReference` is stored, whether facts share a table, and exact Prisma shapes are left to
implementation — with three constraints that are **not** optional: the unique provider ID per mode,
the one-`IN_FLIGHT`-root-operation-per-user constraint, and no cascading delete from `User` into
billing records.

**Decided 2026-09-24** ([IB-14](../../subscription/implementation/open-decisions.md#ib-14--account-removal-storage),
architecture decision): the "no cascading delete" constraint is realised as a **nullable** `userId`
foreign key with `onDelete: Restrict` on every billing and entitlement record, plus a
`subjectPseudonym` column. Actor references (who granted, who performed) are plain identifiers, not
foreign keys. Pseudonymization later nulls `userId` and stamps the pseudonym in one transaction. That
workflow is deferred until the platform has account deletion; the storage shape is not. The Prisma
mapping is in
[`../../subscription/implementation/database-design.md`](../../subscription/implementation/database-design.md).
