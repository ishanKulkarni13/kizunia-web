# Subscription Domain — Relationships

> **Status:** Design — conceptual, not a schema
>
> **Last Updated:** 2026-09-21

```text
User 1 ────── 0..n  Subscription            (history across cancel -> resubscribe cycles;
                                              at most one currently ACTIVE/TRIALING/PENDING/HALTED
                                              at a time)
User 1 ────── 0..n  EntitlementGrant         (multiple may be simultaneously ACTIVE)

Subscription 1 ──── 0..n  SubscriptionHistoryEntry   (append-only)
Subscription 1 ──── 0..1  ProviderReference          (present once a real Razorpay subscription exists)
Subscription 0..1 ─────── 0..n  BillingEvent          (an event concerns at most one Subscription;
                                                        a Subscription accumulates many events over time)

EffectiveAccess = max(tier)
  over { Subscription.phase-implied tier (if currently paid-equivalent) }
  ∪    { EntitlementGrant.plan : status = ACTIVE and within validity window }
  default FREE
```

## Boundaries with other domains

| Domain | Relationship |
| --- | --- |
| **User** | Owns Subscriptions and EntitlementGrants. Subscription & Billing never redefines identity — it reads the existing `User`/`StrictAuthorizationActor` shape |
| **Project** (`ProjectMember`) | Consumes effective access as a quota input (owned-project limit) but is not itself part of this domain — see [`../../subscription/entitlements/quotas-vs-rate-limits.md`](../../subscription/entitlements/quotas-vs-rate-limits.md) |
| **Portfolio** | Consumes effective access through the existing `resolvePortfolioPublicEligibility()` seam — see [`../../subscription/entitlements/authorization-integration.md`](../../subscription/entitlements/authorization-integration.md) |
| **Notifications** | Consumes effective access as an eligibility input at the same user-eligibility stage the notification subsystem already reserved for it — see [`../notifications/README.md`](../notifications/README.md) and [`../../notifications/cross-cutting/feature-flags-and-entitlements.md`](../../notifications/cross-cutting/feature-flags-and-entitlements.md) |
| **Recommendations** | Same pattern as Notifications, at the recommendation-generation service |
| **MCP** | Consumes effective access as an additional check inside the existing `PlatformPolicy`/scope chain, never as a parallel authorization system |
| **Authorization** (`AuthorizationEvaluator`) | Consumes effective access; does not merge with it. `Entitlement + Authorization = Allowed operation` — see [`../../../project/feature-specification/subscription/glossary.md`](../../../project/feature-specification/subscription/glossary.md#3-entitlement-vs-authorization) |

## What this domain does not own

Authorization decisions, resource ownership, rate limiting, and notification/recommendation/MCP
business logic all remain owned by their existing domains. This domain owns exactly: what plan a
user's access resolves to, and why.

## Storage is an implementation-phase decision

The relationships above describe cardinality and ownership, not tables or foreign keys. Whether
`ProviderReference` is embedded on `Subscription` or a related table, whether `BillingEvent`
retention differs from `SubscriptionHistoryEntry` retention, and the exact Prisma model shapes are
left to the implementation phase — consistent with [`overview.md`](overview.md)'s reasoning for why
this document set stops at contracts.
