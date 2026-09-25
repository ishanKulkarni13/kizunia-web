# Phase II — Feature Entitlement Integration

> **Status:** Implemented 2026-09-25 — not yet committed; see [Implementation record](#implementation-record)
>
> **Depends on:** Phase I · **Razorpay needed:** no · **Old slice:** S3

## Objective

Make every paid capability in the [feature matrix](../../../../project/feature-specification/subscription/plans.md) actually enforced, through the existing authorization chains, with effective access (grants, for now) as the only input. After this phase, Free, Pro and Pro+ behave differently everywhere they should, and downgrading never deletes anything.

## Scope

| Capability | Where it is enforced | Ruling |
| --- | --- | --- |
| Owned-project quota (5 / 10 / 20) | `ProjectService.create`, inside its existing transaction | [IB-12](../../implementation/open-decisions.md#ib-12--soft-deleted-projects-and-the-quota) |
| Portfolio creation (Pro and above) | `PortfolioPolicy` create chain | [IB-4](../../implementation/open-decisions.md#ib-4--portfolio-creation-gate) |
| Portfolio public display (Pro and above, **owner's** access) | Async eligibility passed into the portfolio context | [IB-5](../../implementation/open-decisions.md#ib-5--async-portfolio-public-eligibility) |
| Deadline notifications (`REGISTRATION_CLOSING`, Pro and above) | Scheduler predicate + handler/policy re-check + delivery re-check | [IB-2](../../implementation/open-decisions.md#ib-2--recommendation-gate-point) |
| Competition recommendations (`TOP_RELEVANT_COMPETITION`, Pro+) | Same three points | IB-2 |
| MCP (Pro+) | One capability check in MCP dispatch after actor resolution | [authorization integration](../../entitlements/authorization-integration.md#mcp) |
| Admin bypass (interactive gates only) | `.platformOverride()` before each interactive `.require` | [IB-7](../../implementation/open-decisions.md#ib-7--admin-bypass-of-entitlement-gates) |
| Preferences for intents the user is not entitled to | Always stored; the DTO carries `entitled` | [IB-16](../../implementation/open-decisions.md#ib-16--preferences-for-non-entitled-intents) |
| UI | Server-computed flags only (`/me/entitlements`; per-resource DTOs) | [feature integration](../../implementation/feature-integration.md) |

## Architectural components involved

The Phase I effective-access API; `AuthorizationEvaluator` chains in the projects, portfolio and MCP modules; the notification scheduler, handlers, `NotificationPolicyService` and delivery; the preferences service and DTO; `AuthorizationCode.UPGRADE_REQUIRED` / `FEATURE_DISABLED`.

## Dependencies

Phase I: the resolver, the set predicate and grants. Grants are how every capability is exercised in development and tests.

## Files and modules likely affected

Paths are relative to `next/src/`.

- `modules/projects/backend/{service,repository}.ts`: `countOwnedByUser`, the advisory lock and the quota check.
- `modules/portfolio/backend/authorization/{policy,context-resolver,public-eligibility}.ts`, and `service.ts`.
- `modules/notifications/backend/notification-scheduler.service.ts`, `jobs/handlers/*`, `notification-policy.service.ts`, `delivery/delivery.service.ts`, and `policy/types.ts` (the `NOT_ENTITLED` reason), plus a capability map beside `policy/intent-audience.ts`.
- `modules/preferences/backend/notification-preference.service.ts` and its DTO.
- `modules/mcp/server/transport/dispatch.ts`.
- UI components that show "New project", "Create portfolio" or MCP state, or preference toggles; they read server flags.
- `prisma/schema.prisma` plus a migration for the `ProjectMember` index.

## Database and schema work

`ProjectMember @@index([userId, role])` only. No new tables ([persistence boundary](../README.md#persistence-boundary)).

## Domain and application work

- **Project quota:**
  - count `OWNER` memberships whose project has `deletedAt IS NULL`;
  - refuse the create with `403 UPGRADE_REQUIRED` and `details {limit, owned}` when `owned >= limit`;
  - admins bypass it;
  - over-quota users keep every project and lose only creation.
- **Portfolio:**
  - the create chain is `.security` → `.platformOverride()` → `.require(canCreatePortfolio, UPGRADE_REQUIRED)`;
  - public display requires `visibility === PUBLIC` **and** the owner's entitlement, and `visibility` is never written;
  - owners always see and edit their portfolio.
- **Notifications:**
  - the per-intent capability map (`REGISTRATION_CLOSING` → deadline notifications; `TOP_RELEVANT_COMPETITION` → recommendations; the others need nothing);
  - the scheduler uses the **set-based** predicate, never one resolver call per user;
  - the handler and delivery re-check it and suppress with `NOT_ENTITLED`;
  - the recommendation engine stays ungated.
- **MCP:** the capability check runs for `tools/call` (and `tools/list`, for honest discovery). The OAuth connection and consent flow is untouched, and a denial is a tool error carrying `UPGRADE_REQUIRED`.
- **Preferences:** toggles are always stored; the DTO gains `entitled` per intent.

## Provider work

None.

## Integration work

- The UI reads `canCreateOwnedProject`, `canCreatePortfolio`, MCP availability and per-intent `entitled` flags from the server. It never counts or compares plans itself.
- Copy for denials: "requires Pro" / "requires Pro+".

## Authorization and entitlement implications

- Feature code asks capability or quota questions only, never plan names (SB-PL-02). A lint rule forbids importing `MembershipPlan` outside `lib/entitlements` and `modules/billing`.
- The admin bypass applies to interactive gates only (IB-7). Background notification eligibility has no bypass.
- `PlatformPermissionSet` is unchanged: `CREATE_PORTFOLIO` and `CREATE_PROJECT` stay in `BASELINE`.

## Concurrency and transaction considerations

- **Quota race:** a transaction-scoped, per-user `pg_advisory_xact_lock`, taken inside `ProjectService.create`'s existing transaction **before** the count. This is the repository's first advisory lock; document the pattern in code.
- The entitlement read inside that transaction uses the transaction client.
- The notification scheduler's set predicate runs in its existing query, with no per-user round trips.

## Observability requirements

- `NOT_ENTITLED` suppressions are visible through the existing notification observability.
- Quota refusals are logged at debug level with `{limit, owned}`, and never with plan names in feature logs.

## Testing requirements

**Integration:**
- quota at 9/10 with two concurrent creates → exactly one succeeds;
- soft-deleted projects excluded;
- admin override;
- **downgrade suite:** revoke the grant → projects kept and creation refused; the portfolio hidden publicly but still editable, with `visibility` unchanged; preferences unchanged; MCP refused with tokens intact; re-granting restores everything with no writes;
- notifications: the scheduler excludes non-entitled users; the handler suppresses `NOT_ENTITLED`; Pro gets deadline notifications but not recommendations;
- MCP denied for Free and Pro, allowed for Pro+ and admins;
- preferences stored for a Free user, with `entitled: false`.

**Unit:**
- `PortfolioPolicy` create with and without the capability and with the admin override;
- public view returns `FEATURE_DISABLED` (extend the existing tests; replace the always-`true` tripwire test).

## Acceptance criteria

- [x] Every row of the feature matrix is enforced server-side and verified by a test driven by grants.
- [x] Two concurrent project creates at the quota edge never both succeed.
- [x] Deleting a project frees a quota slot.
- [x] Losing access deletes nothing and overwrites no user setting. Regaining it restores behavior with no data change.
- [x] Admins pass the quota, portfolio-create and MCP gates, and do **not** receive gated notifications without a grant.
- [x] No feature module references a plan name or any billing table.

## Explicit non-goals

- Paid subscriptions as an access source (Phase III adds them to the resolver).
- Plan-tier rate limits.
- Removing the TEMPORARY recommendations route (Phase IX).
- Ownership transfer or project restore. If either is ever added, it must re-check the quota.

## Decisions that must already be settled

IB-2, IB-4, IB-5, IB-7, IB-12, IB-16, SB-DP-01…03. **All are DECIDED.**

## Risks and blockers

- **Risk:** the async portfolio eligibility touches both the public and owner paths. Keep the policy shape and test the owner branch.
- **Risk:** the set predicate and the per-user check drift. Reuse the Phase I agreement fixtures.
- **Risk:** gates reach production before checkout exists. Accepted: the product is pre-production with zero users (IB-8 withdrawn), and grants cover testing.
- **Blockers:** none.

## Expected output

Enforced gates in the projects, portfolio, notifications and MCP modules; the `NOT_ENTITLED` suppression; the preference `entitled` flag; the UI reading server flags; the index migration; the downgrade and quota-race test suites.

## Implementation record

Implemented 2026-09-25. Every [acceptance criterion](#acceptance-criteria) is met and covered by a grant-driven test. Paths are relative to `next/src/`.

**What was built**

- **Project quota** (`modules/projects`):
  - `ProjectService.create` takes a transaction-scoped, per-user `pg_advisory_xact_lock` (`ProjectRepository.lockOwnedProjectQuota`, the repository's first advisory lock, documented in place).
  - It then counts owned non-deleted projects (`countOwnedByUser`), reads the quota through the same transaction (`getQuota(..., { db: tx })`) and asks `ProjectPolicy.canCreateOwned` (`.platformOverride()`, then `owned < limit`, `UPGRADE_REQUIRED`).
  - A refusal is a 403 carrying `{ limit, owned }`.
  - `ProjectService.getOwnershipAllowance` runs the same policy without the lock and backs `GET /api/v1/projects/mine/allowance` and the "New Project" button.
  - Migration `20260924000200_project_member_user_role_index` adds `ProjectMember @@index([userId, role])`. It is the only schema change.
- **Portfolio** (`modules/portfolio/backend/authorization`):
  - The create chain is now `.security`, `.platformOverride()`, `UNAUTHORIZED`, then `UPGRADE_REQUIRED` from `actorCanCreatePortfolio`.
  - `resolvePortfolioPublicEligibility` is async and asks for the **owner's** portfolio capability.
  - `forCreate` and `forPublicRead` are async and pass their answers into the still-synchronous `fromData`. `PortfolioPolicy.canView` is unchanged in shape.
- **Notifications** (`modules/notifications`):
  - `policy/intent-capability.ts` maps `REGISTRATION_CLOSING` to deadline notifications and `TOP_RELEVANT_COMPETITION` to recommendations.
  - `backend/notification-entitlement.ts` is the one door to `lib/entitlements` (the set form for the scheduler, the per-user form for the re-checks).
  - The check runs in the scheduler's eligible-user query, in `evaluate-registration-closing.handler.ts` and `NotificationPolicyService.evaluateTopRelevantCompetition` (before the engine runs), and in `DeliveryService.deliver`.
  - The pure policies gained an `entitled` input and the `NOT_ENTITLED` reason.
- **Preferences** (`modules/preferences`): the DTO gained `entitled` and `requiredPlan` per intent. `update` still always stores.
- **MCP** (`modules/mcp`):
  - `authorization/mcp-access.ts` is the one subscription check, called once from `dispatch.ts` for `tools/call` (after the rate limit, before input parsing) and for `tools/list`.
  - Scopes, actor resolution, OAuth and rate limiting are untouched, and no tool contains subscription logic.
- **Shared:**
  - `minimumPlanFor` and `PLAN_DISPLAY_NAME` in `lib/entitlements/catalog.ts`, so "requires Pro+" copy follows the catalog.
  - An optional `details` argument on `Authorization.assert`.
  - An ESLint `no-restricted-imports` rule (`eslint.config.mjs`) keeping `MembershipPlan` inside `lib/entitlements` and `modules/billing`, and keeping Razorpay and billing out of the feature modules.

**Implementation decisions** (each a Phase II choice, not a change to a settled decision)

- **The allowance flag lives in the projects module**, at `/api/v1/projects/mine/allowance`, not on `/me/entitlements`. Feature modules may not import billing, and "how many projects do I own" is a projects fact. `/me/entitlements` is unchanged. The portfolio page reads it (app layer) for explanatory copy only.
- **`tools/list` returns an empty list** to a user without MCP access, so discovery matches what will work. Authentication failures on it are still protocol errors.
- **`PortfolioContextResolver.fromData` stays synchronous and fails closed** (`isPubliclyDisplayable` and `actorCanCreatePortfolio` default to `false`). Its synchronous callers are owner paths whose rules never read either flag, so nothing else had to change.
- **The notification re-checks ask about "now", not the scheduler's frozen anchor**, because their job is to catch access lost after scheduling. The scheduler query uses the anchor.
- **`NOT_ENTITLED` needs no migration.** Suppression reasons are a TypeScript union that only reaches logs.
- **A delivery-time skip may record no `SKIPPED` row.** Delivery rows are created lazily, as with the existing `INTENT_DISABLED` skip. The skip is always logged (`delivery.skipped`, `reason: NOT_ENTITLED`), and no push is sent.
- **Quota refusals are logged at `info`**, not debug, because `lib/logger` has no debug level. The event is `project.create_refused_quota` with `{ userId, limit, owned }` and no plan name.
- **Test fixtures** (`testing/entitlement-fixtures.ts`) are shared with the Phase I resolver test, including the agreement fixtures, so the scheduler is checked against the same set. Existing portfolio, notification and technologies suites that create portfolios or gated notifications now grant the capability through a real grant instead of relying on the old ungated behavior.

**Gaps and behavior worth knowing**

- **MCP tool failures do not carry `details`** for authorization errors (`toMcpToolFailure` forwards it only for validation errors). Nothing in Phase II needs it: the MCP denial has no `details`, and project creation is not exposed through MCP. If a quota-bearing MCP tool is ever added, that translator needs a deliberate decision.
- **There is no MCP settings page**, so "MCP availability" has no UI surface to update. The gate is server-side only.
- **`UPGRADE_REQUIRED` and `FEATURE_DISABLED` are still HTTP 403.** No status distinguishes them, and the client relies on the `code`.
- **The recommendation engine is deliberately ungated**, and a test confirms a FREE user's engine call still returns results. The TEMPORARY route is unchanged (Phase IX).

**Verification.**

- New test files:
  - integration: `project-quota`, `portfolio-entitlement`, `notification-entitlement` and `mcp-access`;
  - unit: `ownership-quota.policy`, `mcp-access`, `intent-capability` and `feature-boundaries`.
- Extended tests: `policy`, `public-eligibility`, both notification policies, `dispatch`, `catalog`, `notification-preference` and `portfolio-public-visibility`.
- The quota race tests fail (two creates succeed) with the lock removed, and the notification suite fails 13 of 21 with the gates neutralised.
- `tsc` and `next build` are clean, and `eslint` on the 62 touched files reports no errors.

**Known issues, not caused by this phase**

- `delivery.integration.test.ts` › "skips a push that is no longer worth sending" fails on a clean checkout. It depends on a hard-coded `NOW` in September 2026 against a `createdAt` set by the real clock (the Phase I record notes this too).
- `lib/auth.mcp-scopes.test.ts` can time out at 5 s on a cold import of the auth module when the whole unit suite runs in parallel. It passes alone.
- The 60-second fixed-window rate limiter makes tests that exhaust a policy in a loop (`portfolio-rate-limit.integration.test.ts`) occasionally straddle a window boundary. They pass on repeat. The new MCP ordering test avoids this by counting spent budget instead.
- `eslint` still reports the empty-interface error in `authorization/platform/context.ts`, which this phase does not touch.

**For Phase III.** Add paid subscriptions as another source in `lib/entitlements/resolver.ts` and `grant-predicate.ts` (the per-user and set forms together, guarded by the shared agreement fixtures). Feature modules should need no change, and `feature-boundaries.test.ts` fails if one starts naming a plan or reading grant tables.
