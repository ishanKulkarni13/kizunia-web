# Existing Feature Integration

> **Status:** Implementation plan — not implemented
>
> **Last Updated:** 2026-09-24
>
> **Blueprint section:** §15 (see the [section map](README.md#blueprint-section-map))

How subscriptions integrate with project creation and quota, portfolio, deadline notifications, recommendations, MCP, existing authorization and admin authorization: the current code path, the new dependency, where the check belongs, and what must not be duplicated.

**Open decisions referenced here:** [IB-2](open-decisions.md#ib-2--recommendation-gate-point), [IB-3](open-decisions.md#ib-3--entitlement-resolver-signature), [IB-4](open-decisions.md#ib-4--portfolio-creation-gate), [IB-5](open-decisions.md#ib-5--async-portfolio-public-eligibility), [IB-7](open-decisions.md#ib-7--admin-bypass-of-entitlement-gates), [IB-15](open-decisions.md#ib-15--billing-admin-roles). Text that follows a recommended resolution is provisional until that item is ruled; see [open decisions](open-decisions.md).

---

| Feature | Current code path | New dependency | Where the check goes | Must NOT be duplicated / changed |
| --- | --- | --- | --- | --- |
| **Project create / quota** | `POST /api/v1/projects` → `ProjectController.create` → `ProjectService.create` (`service.ts:274`) → `PlatformAuthorizer.can(CREATE_PROJECT)` → `$transaction` (project + OWNER member) | `resolveEntitlements(userId, {db: tx})`, `countOwnedByUser` | Inside the existing transaction, after the advisory lock | No second count elsewhere; `ProjectAuthorizer.create` (unused) stays unused; `CREATE_PROJECT` stays in `BASELINE`; the UI's "New project" button reads a server `canCreateOwnedProject` flag from `/me/billing` or `/me/entitlements` and never counts itself |
| **Portfolio create** | `POST /api/v1/portfolio` → `PortfolioService.create` (`service.ts:125`) → `PlatformAuthorizer.can(CREATE_PORTFOLIO)` → `PortfolioAuthorizer.create` | Actor entitlements in `PortfolioContext` | `PortfolioPolicy` create chain `.require(capabilities.portfolio, UPGRADE_REQUIRED)` (IB-4) | `PlatformPermissionSet` unchanged; no check in the controller or UI |
| **Portfolio public** | `GET /api/v1/portfolio/[username]` → `PortfolioService.findPublicByUsername` → `PortfolioContextResolver.forPublicRead` → `PortfolioPolicy.canView` | `hasCapability(owner, PORTFOLIO)` | Body of `resolvePortfolioPublicEligibility` (made async, IB-5) | `visibility` never written; owner branch keeps skipping it; the SQL pre-filter in the repository must not add an entitlement filter of its own |
| **Deadline notifications** | tick → `NotificationTickService` → `NotificationSchedulerService.findEnabledUserIds` → job `EVALUATE_REGISTRATION_CLOSING` → handler → `DeliveryService` | `entitledUsersWhere(DEADLINE_NOTIFICATIONS)`, `hasCapability` | Scheduler `where` (set form) + handler first check + delivery `intentStillEnabled` sibling | Preferences never reset; `NotificationPreferenceService.isEnabledForUser` stays preference-only; no plan names in the notification module (a `INTENT_REQUIRED_CAPABILITY` map beside `intent-audience.ts`) |
| **Recommendations** | `TOP_RELEVANT_COMPETITION` via `NotificationPolicyService.evaluateTopRelevantCompetition` → `RecommendationService.generateForUser`; debug route (testing-only) | Same as above | Scheduler + policy-service re-check + delivery (IB-2) | `RecommendationService` stays ungated (deadline notifications need it); the testing route is removed, not gated; competition preference editing stays available to Pro |
| **MCP** | `POST /api/mcp` → `withMcpAuth` → `dispatchMcpRequest` → `buildMcpRequestContext` (actor via `McpActorResolver`) → `requireScope` → use case → domain authorizer | `resolveEntitlements(actor.id)` | Once in `dispatch.ts` after context build, for `tools/call` (and `tools/list`), with `platformOverride` (IB-7) | No `mcpCanX()` helper (per `authorize-mcp.ts`); OAuth consent and tokens untouched (config preserved); scopes unchanged |
| **Existing authorization** | `AuthorizationEvaluator` chains; `PlatformPolicy` (no override) | Entitlements as a context input | Per-feature policy chains | No parallel permission system; no dynamic permission sets |
| **Admin authorization** | `admin/layout.tsx` guard; per-route `PlatformAuthorizer.can` | New actions (IB-15) | Billing admin services | Admin bypass never grants billing-admin actions implicitly |
| **Rate limiting** | `RateLimitService.decide` → `resolvePolicy(…, entitlements)` | none in V1 (IB-3) | — | Never Razorpay-aware |
| **UI** | Server-computed permission DTOs (projects), sidebar role hint | `GET /api/v1/me/billing` summary with `allowedActions` and capability flags | Server | No client plan/quota logic. Fix the existing client-side rule duplication in `portfolio-project-card.tsx:45` separately; it is unrelated |

---

## Related documents

**In this directory**

- [Effective Access](effective-access.md)
- [Entitlements and Quotas](entitlements-and-quotas.md)
- [Admin Grants](admin-grants.md)
- [Open decisions](open-decisions.md) · [Settled decisions](settled-decisions.md) · [Index](README.md)

**Design and specification**

- [Authorization integration (design)](../entitlements/authorization-integration.md)
- [Authorization architecture](../../authorization/README.md)
- [MCP architecture](../../mcp/README.md)
- [Notifications — feature flags and entitlements](../../notifications/cross-cutting/feature-flags-and-entitlements.md)
