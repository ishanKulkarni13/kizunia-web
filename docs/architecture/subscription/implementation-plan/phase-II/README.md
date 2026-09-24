# Phase II — Feature Entitlement Integration

> **Status:** Not started
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

- [ ] Every row of the feature matrix is enforced server-side and verified by a test driven by grants.
- [ ] Two concurrent project creates at the quota edge never both succeed.
- [ ] Deleting a project frees a quota slot.
- [ ] Losing access deletes nothing and overwrites no user setting. Regaining it restores behavior with no data change.
- [ ] Admins pass the quota, portfolio-create and MCP gates, and do **not** receive gated notifications without a grant.
- [ ] No feature module references a plan name or any billing table.

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
