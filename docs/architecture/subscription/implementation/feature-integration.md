# Existing Feature Integration

> **Status:** Implementation plan — not implemented
>
> **Last Updated:** 2026-09-24
>
> **Blueprint section:** §15 (see the [section map](README.md#blueprint-section-map))

How subscriptions integrate with project creation and quota, portfolio, deadline notifications, recommendations, MCP, existing authorization and admin authorization: the current code path, the new dependency, where the check belongs, and what must not be duplicated.

**Decisions referenced here:** [IB-2](open-decisions.md#ib-2--recommendation-gate-point), [IB-3](open-decisions.md#ib-3--entitlement-resolver-signature), [IB-4](open-decisions.md#ib-4--portfolio-creation-gate), [IB-5](open-decisions.md#ib-5--async-portfolio-public-eligibility), [IB-7](open-decisions.md#ib-7--admin-bypass-of-entitlement-gates), [IB-15](open-decisions.md#ib-15--billing-admin-roles). All were ruled on 2026-09-24; see [open decisions](open-decisions.md) for each ruling and who made it (product decision (owner) or architecture decision (autonomous)).

---

| Feature | Current code path | New dependency | Where the check goes | Must NOT be duplicated / changed |
| --- | --- | --- | --- | --- |
| **Project create / quota** | `POST /api/v1/projects` → `ProjectController.create` → `ProjectService.create` (`service.ts:274`) → `PlatformAuthorizer.can(CREATE_PROJECT)` → `$transaction` (project + OWNER member) | The per-user effective-access API (IB-3; name chosen in Phase I) reading through `tx`, `countOwnedByUser` (non-deleted projects, IB-12) | Inside the existing transaction, after the per-user advisory lock; `.platformOverride()` for `ADMIN`/`SUPER_ADMIN` first (IB-7) | No second count elsewhere; `ProjectAuthorizer.create` (unused) stays unused; `CREATE_PROJECT` stays in `BASELINE`; the UI's "New project" button reads a server `canCreateOwnedProject` flag from `/me/billing` or `/me/entitlements` and never counts itself |
| **Portfolio create** | `POST /api/v1/portfolio` → `PortfolioService.create` (`service.ts:125`) → `PlatformAuthorizer.can(CREATE_PORTFOLIO)` → `PortfolioAuthorizer.create` | Actor entitlements in `PortfolioContext` | `PortfolioPolicy` create chain `.platformOverride()` then `.require(capabilities.portfolio, UPGRADE_REQUIRED)` (IB-4, IB-7) | `PlatformPermissionSet` unchanged; no check in the controller or UI |
| **Portfolio public** | `GET /api/v1/portfolio/[username]` → `PortfolioService.findPublicByUsername` → `PortfolioContextResolver.forPublicRead` → `PortfolioPolicy.canView` | `hasCapability(owner, PORTFOLIO)` | `resolvePortfolioPublicEligibility`, made async and computed before the context is built (IB-5); the owner's access, never their role (IB-7) | `visibility` never written; owner branch keeps skipping it; the SQL pre-filter in the repository must not add an entitlement filter of its own |
| **Deadline notifications** | tick → `NotificationTickService` → `NotificationSchedulerService.findEnabledUserIds` → job `EVALUATE_REGISTRATION_CLOSING` → handler → `DeliveryService` | `entitledUsersWhere(DEADLINE_NOTIFICATIONS)`, `hasCapability` | Scheduler `where` (set form) + handler first check + delivery `intentStillEnabled` sibling | Preferences never reset; `NotificationPreferenceService.isEnabledForUser` stays preference-only; no plan names in the notification module (a `INTENT_REQUIRED_CAPABILITY` map beside `intent-audience.ts`) |
| **Recommendations** | `TOP_RELEVANT_COMPETITION` via `NotificationPolicyService.evaluateTopRelevantCompetition` → `RecommendationService.generateForUser`; debug route (testing-only) | Same as above | Scheduler + policy-service re-check + delivery (IB-2) | `RecommendationService` stays ungated (deadline notifications need it); the testing route is removed, not gated; competition preference editing stays available to Pro |
| **MCP** | `POST /api/mcp` → `withMcpAuth` → `dispatchMcpRequest` → `buildMcpRequestContext` (actor via `McpActorResolver`) → `requireScope` → use case → domain authorizer | The per-user effective-access API for `actor.id` | Once in `dispatch.ts` after context build, for `tools/call` (and `tools/list`), with `platformOverride` (IB-7) | No `mcpCanX()` helper (per `authorize-mcp.ts`); OAuth consent and tokens untouched (config preserved); scopes unchanged |
| **Notification preferences** | `NotificationPreferenceService` get/update and its DTO | `hasCapability` per intent | The DTO gains a server-computed `entitled` flag per intent (IB-16) | The toggle is always stored; the update path never refuses a non-entitled intent; the UI shows "requires Pro / Pro+" |
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
