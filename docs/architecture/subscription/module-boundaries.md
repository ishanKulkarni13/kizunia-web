# Module Boundaries

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

What Subscription & Billing owns, what it consumes, and what it must never touch directly.

---

## What this subsystem owns

- The `Subscription` and `EntitlementGrant` domain records and their lifecycle
- Effective-access resolution (the real body of `lib/entitlements`'s `resolveEntitlements()`)
- The Razorpay provider boundary (`create/fetch/update/cancel subscription`, `verify/parse webhook`)
- Webhook receipt, verification, persistence, and processing
- Reconciliation
- Subscription history and admin-grant audit trails
- Admin-grant and promotion management

## What it consumes, and does not own

| Consumes | Owned by | Never |
| --- | --- | --- |
| `AuthorizationEvaluator`, `PlatformPermissionSet`, `AuthorizationCode` | Authorization | Builds a parallel permission system |
| `ProjectMember` ownership counts | Projects | Redefines what "owned" means |
| `resolvePortfolioPublicEligibility()` | Portfolio | Adds a new schema field to Portfolio, or touches `visibility` |
| The notification-eligibility seam and its scheduler query | Notifications | Becomes the notification system |
| `RecommendationService.generateForUser`'s entry point | Recommendations | Duplicates the recommendation engine |
| `PlatformPolicy`/scope chain | MCP | Adds an MCP-specific authorization helper |
| `resolvePolicy`'s `entitlements` parameter | Rate limiting | Makes rate limiting Razorpay-aware |
| The notification subsystem's Postgres work-queue pattern | Background jobs | Introduces a second, differently-shaped queue |
| The `internal-jobs` tick/task-registry convention | Scheduled work | Introduces a new scheduling mechanism |

## What must never happen

- Any module outside the provider boundary importing a Razorpay SDK type or branching on a Razorpay
  status string. See [`provider-boundary/identifiers.md`](provider-boundary/identifiers.md).
- Any feature check written as `if (user.plan === ...)` instead of a capability/quota question. See
  [SB-PL-02](../../project/feature-specification/subscription/decisions/plans-and-quotas.md#sb-pl-02--capabilities-are-checked-not-plan-names).
- Any code path that must reach Razorpay to determine a Free user's access.
- Any admin-grant or promotion operation calling a Razorpay API.
