# Authorization Integration

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24 (decision close-out: IB-2, IB-4, IB-5, IB-7)

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

Wiring this seam means eligibility becomes: resolve the portfolio **owner's** effective access and
return whether it includes the portfolio capability. No schema change, no change to
`PortfolioPolicy`'s shape, no change to `visibility`. This is the mechanism behind
[SB-DP-02/SB-DP-03](../../../project/feature-specification/subscription/decisions/data-preservation.md).

**Correction (decided 2026-09-24, [IB-5](../implementation/open-decisions.md#ib-5--async-portfolio-public-eligibility)).**
This section used to say only the function's *body* changes. That is not possible: the function is
called from the synchronous `PortfolioContextResolver.fromData`/`forPublicRead`, and an entitlement
read is asynchronous I/O. Eligibility is therefore computed asynchronously **before** the context is
built and passed into it. `PortfolioPolicy` keeps its shape. Owners always see their own portfolio;
only non-owner viewers meet this gate.

## `CREATE_PORTFOLIO` baseline grant

**Decided 2026-09-24 ([IB-4](../implementation/open-decisions.md#ib-4--portfolio-creation-gate)):**
`CREATE_PORTFOLIO` **stays in `BASELINE`**, meaning "this role may create portfolios". The entitlement
check lives in `PortfolioPolicy`'s create chain instead:

```text
PortfolioPolicy (create):
  .security(!actor.banned)
  .platformOverride()                                   -- ADMIN / SUPER_ADMIN (IB-7)
  .require(ctx => ctx.actorAccess.canCreatePortfolio, UPGRADE_REQUIRED, ...)
  ...existing rules
```

The actor's effective access is resolved asynchronously by the context resolver and carried in
`PortfolioContext`.

*Superseded text:* this section used to say the baseline grant would "become conditional on
effective access" by changing only `PlatformPermissionSet`'s data. That cannot work. The permission
set is a static `role → actions` map, the platform context carries only the actor, and the
authorization conventions forbid dynamic permission sets.

## Project-create quota

See [`quotas-vs-rate-limits.md`](quotas-vs-rate-limits.md#project-ownership-quota). Admins bypass it
through `.platformOverride()` ([IB-7](../implementation/open-decisions.md#ib-7--admin-bypass-of-entitlement-gates)).

## Admin bypass — scope

Decided 2026-09-24 as a product decision (owner),
[IB-7](../implementation/open-decisions.md#ib-7--admin-bypass-of-entitlement-gates):

- **Interactive gates** (project quota, portfolio creation, MCP) apply `.platformOverride()`, which is
  true for `ADMIN`/`SUPER_ADMIN` and not `MODERATOR`, before the entitlement `.require`.
- **Background eligibility** (notification intents) has no bypass.
- **Public portfolio display** follows the owner's effective access, never their role.

## Notification scheduler and handlers

The notification subsystem's own architecture already names the exact insertion point: the
scheduler's `findEnabledUserIds`-style query gets an additional entitlement filter alongside its
existing `enabled=true`/`banned`/`status` filters, and each handler's `isEnabledForUser`-style
re-check gets a parallel, ID-scoped `hasEntitlement(userId, capability)` call — matching the
existing pattern exactly, since background jobs do not have a session actor to run through
`AuthorizationEvaluator` at all (see `kizunia-authorization-compressed-wind.md` §8, §14). This
function is a thin wrapper over [`effective-access-resolution.md`](effective-access-resolution.md),
not a new authorization mechanism.

**Decided 2026-09-24 ([IB-2](../implementation/open-decisions.md#ib-2--recommendation-gate-point)):**
the gate is per **intent**:

- `REGISTRATION_CLOSING` requires the deadline-notifications capability (Pro and above);
- `TOP_RELEVANT_COMPETITION` requires the recommendations capability (Pro+).

It is checked three times: in the scheduler query, in the handler / `NotificationPolicyService`
re-check, and at delivery. A failure is suppressed with the new reason `NOT_ENTITLED`. There is **no
admin bypass** here, because background jobs have no actor
([IB-7](../implementation/open-decisions.md#ib-7--admin-bypass-of-entitlement-gates)). Preferences
are stored whatever the entitlement
([IB-16](../implementation/open-decisions.md#ib-16--preferences-for-non-entitled-intents)).

The scheduler's filter must not call the per-user resolver once per user (at 100k users that is 100k
round trips per sweep). It uses the **set-based form** of the same rule — "users whose effective
access includes capability C at time t" — built from the one shared definition, so the batch filter
and the per-user check cannot drift
([`effective-access-resolution.md`](effective-access-resolution.md#one-definition-two-shapes)).

## Recommendation route

**Superseded 2026-09-24 ([IB-2](../implementation/open-decisions.md#ib-2--recommendation-gate-point)).**
The route below is marked *TEMPORARY — MUST BE REMOVED BEFORE PRODUCTION* in the code
(`app/api/v1/me/recommendations/competitions/route.ts`), and the recommendation engine behind it
also powers **Pro** deadline notifications. Gating the route or the engine at Pro+ would therefore
break a Pro feature and gate something that will not ship. The "competition recommendations"
capability is gated at the `TOP_RELEVANT_COMPETITION` notification intent instead
([above](#notification-scheduler-and-handlers)). The TEMPORARY route stays ungated for development,
and removing it is a LIVE-readiness item
([Phase IX](../implementation-plan/phase-IX/README.md)). Original text, kept for history:

> `RecommendationController.generateForCurrentUser` gains an explicit entitlement check (Pro+ required
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

**Decided 2026-09-24:**

- The check is **one capability check in MCP dispatch** (`mcp/server/transport/dispatch.ts`), made
  after the actor is resolved and before any tool runs. It is an `AuthorizationEvaluator` chain of
  `.platformOverride()` ([IB-7](../implementation/open-decisions.md#ib-7--admin-bypass-of-entitlement-gates))
  then `.require(mcp capability, UPGRADE_REQUIRED)`.
- It is **not** a new `PlatformAction` in the static permission set, for the same reason as
  [IB-4](../implementation/open-decisions.md#ib-4--portfolio-creation-gate).
- The OAuth connection and consent flow is not gated. Tool calls are, because entitlement can change
  after a token is issued.

## Denial codes

Every entitlement-driven denial uses the already-reserved `AuthorizationCode.UPGRADE_REQUIRED` (the
user needs a higher plan) or `FEATURE_DISABLED` (the capability isn't available to this user's
current access for a reason other than "needs a higher plan," e.g. an expired grant) — no new denial
code vocabulary is introduced.
