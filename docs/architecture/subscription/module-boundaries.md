# Module Boundaries

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24

What Subscription & Billing owns, what it consumes, and what it must never touch directly.

---

## What this subsystem owns

- The `Subscription`, `EntitlementGrant`, `BillingOperation`, `BillingEvent`, money-fact,
  `SubscriptionHistoryEntry` and `BillingAnomaly` records and their lifecycles
- Effective-access resolution (the real body of `lib/entitlements`'s `resolveEntitlements()`), in
  its per-user and set-based forms
- The Razorpay provider boundary and the per-mode plan catalog
- Commands (every provider mutation), synchronization, reconciliation scheduling, orphan discovery
- The outbound Razorpay request budget and global cooldown (their *counters* live in the rate-limit
  store; the policy is billing's)
- Webhook receipt, verification and recording
- Subscription history, admin-grant audit, anomalies
- Admin-grant and promotion management

## What it consumes, and does not own

| Consumes | Owned by | Never |
| --- | --- | --- |
| `AuthorizationEvaluator`, `PlatformPermissionSet`, `AuthorizationCode` | Authorization | Builds a parallel permission system |
| `ProjectMember` ownership counts | Projects | Redefines what "owned" means |
| `resolvePortfolioPublicEligibility()` | Portfolio | Adds a new schema field to Portfolio, or touches `visibility` |
| The notification-eligibility seam and its scheduler query | Notifications | Becomes the notification system |
| The recommendation engine, unchanged and **ungated**. The recommendations capability is enforced at the `TOP_RELEVANT_COMPETITION` notification intent, because the engine also serves the Pro deadline intent ([IB-2](implementation/open-decisions.md#ib-2--recommendation-gate-point); this row used to name `RecommendationService.generateForUser`'s entry point as the gate) | Recommendations | Duplicates or gates the recommendation engine |
| MCP dispatch, after actor resolution: one `AuthorizationEvaluator` capability check with `.platformOverride()` ([authorization integration](entitlements/authorization-integration.md#mcp)) | MCP | Adds an MCP-specific authorization helper, or a dynamic permission set |
| `resolvePolicy`'s `entitlements` parameter | Rate limiting | Makes rate limiting Razorpay-aware |
| The Postgres rate-limit store's atomic counters | Rate limiting | Mixes the provider budget into user-facing rate-limit policies |
| The notification work queue's claim-with-lease and `P2002` conventions | Background jobs | Introduces a second, differently-shaped queue or worker platform |
| The `internal-jobs` tick/task-registry convention | Scheduled work | Introduces a new scheduling mechanism, or depends on a particular scheduler |
| Next.js `after()` | Framework | Relies on it for correctness (it only shortens latency) |

## What must never happen

- Any module outside the billing module importing a Razorpay SDK type, reading a Razorpay ID, or
  branching on a Razorpay status string. See [`provider-boundary/identifiers.md`](provider-boundary/identifiers.md).
- Any feature check written as `if (user.plan === ...)` instead of a capability/quota question. See
  [SB-PL-02](../../project/feature-specification/subscription/decisions/plans-and-quotas.md#sb-pl-02--capabilities-are-checked-not-plan-names).
- Any code path that must reach Razorpay to determine anyone's access, Free or paid.
- Any admin-grant or promotion operation calling a Razorpay API.
- A Razorpay call made while holding a database transaction or row lock.
- A Razorpay mutation issued by a background process (sync, reconciliation, orphan discovery).
- A Razorpay call that bypasses the request budget.
- A phase written from a webhook payload, a client request, or a timer.
- A database cascade from `User` into billing records.
