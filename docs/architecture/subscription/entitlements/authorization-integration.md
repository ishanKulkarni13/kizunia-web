# Authorization Integration

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24

Entitlement resolution is consumed by the existing `AuthorizationEvaluator` chain at every seam the
authorization audit (`kizunia-authorization-compressed-wind.md`) already identified as prepared for
it. No new authorization system is introduced. See
[`../principles.md`](../principles.md).

---

## Portfolio public eligibility

The most concrete, already-wired seam in the codebase:
`portfolio/backend/authorization/public-eligibility.ts`'s `resolvePortfolioPublicEligibility()`
today always returns `true`, and is already consumed as a second, sequential check inside
`PortfolioPolicy.canView`, after the owner's own `visibility` check, denying with
`AuthorizationCode.FEATURE_DISABLED` when it fails.

```text
PortfolioPolicy.canView(context):
  .require(ctx => ctx.visibility === PUBLIC, RESOURCE_PRIVATE, ...)
  .require(ctx => ctx.isPubliclyDisplayable, FEATURE_DISABLED, ...)   <- becomes a real check
```

Wiring this seam means `resolvePortfolioPublicEligibility()`'s body becomes: resolve the portfolio
owner's effective access, return whether it includes the portfolio capability. No schema change, no
change to `PortfolioPolicy`'s shape, no change to `visibility`. This is the mechanism behind
[SB-DP-02/SB-DP-03](../../../project/feature-specification/subscription/decisions/data-preservation.md).

## `CREATE_PORTFOLIO` baseline grant

`authorization/platform/permission-set.ts`'s `CREATE_PORTFOLIO` baseline entry is already commented
as the seam for this — the grant becomes conditional on effective access including the portfolio
capability, replacing the current "every role" baseline. `PortfolioService.create`'s existing
`PlatformAuthorizer.can(..., CREATE_PORTFOLIO)` call needs no change; only `PlatformPermissionSet`'s
data changes.

## Project-create quota

See [`quotas-vs-rate-limits.md`](quotas-vs-rate-limits.md#project-ownership-quota).

## Notification scheduler and handlers

The notification subsystem's own architecture already names the exact insertion point: the
scheduler's `findEnabledUserIds`-style query gets an additional entitlement filter alongside its
existing `enabled=true`/`banned`/`status` filters, and each handler's `isEnabledForUser`-style
re-check gets a parallel, ID-scoped `hasEntitlement(userId, capability)` call — matching the
existing pattern exactly, since background jobs do not have a session actor to run through
`AuthorizationEvaluator` at all (see `kizunia-authorization-compressed-wind.md` §8, §14). This
function is a thin wrapper over [`effective-access-resolution.md`](effective-access-resolution.md),
not a new authorization mechanism.

The scheduler's filter must not call the per-user resolver once per user (at 100k users that is 100k
round trips per sweep). It uses the **set-based form** of the same rule — "users whose effective
access includes capability C at time t" — built from the one shared definition, so the batch filter
and the per-user check cannot drift
([`effective-access-resolution.md`](effective-access-resolution.md#one-definition-two-shapes)).

## Recommendation route

`RecommendationController.generateForCurrentUser` gains an explicit entitlement check (Pro+ required
for competition recommendations — [SB-PL-05](../../../project/feature-specification/subscription/decisions/plans-and-quotas.md#sb-pl-05--recommendations-require-pro-not-pro)) at the same point authentication
and rate-limiting already run. The audit specifically flagged this route as *not* automatically
covered by any notification-path gate — this check is added here explicitly, not assumed to be
inherited (`kizunia-authorization-compressed-wind.md` §9, §18, P2-1).

## MCP

An entitlement check for MCP tools plugs in as an additional `PlatformAction`/permission check
reused by both MCP and REST — consistent with the codebase's own documented rule that MCP never gets
a parallel, MCP-specific authorization helper (`kizunia-authorization-compressed-wind.md` §10). MCP
access itself (`SB-PL-01`'s Pro+ requirement) is checked at the same scope-gate-then-policy point
every other MCP authorization decision already goes through.

## Denial codes

Every entitlement-driven denial uses the already-reserved `AuthorizationCode.UPGRADE_REQUIRED` (the
user needs a higher plan) or `FEATURE_DISABLED` (the capability isn't available to this user's
current access for a reason other than "needs a higher plan," e.g. an expired grant) — no new denial
code vocabulary is introduced.
