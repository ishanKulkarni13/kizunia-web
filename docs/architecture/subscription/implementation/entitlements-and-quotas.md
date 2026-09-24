# Entitlements and Quotas

> **Status:** Implementation plan — not implemented
>
> **Last Updated:** 2026-09-24
>
> **Blueprint section:** §13 (see the [section map](README.md#blueprint-section-map))

The concrete capability and quota table, where each is enforced, quota enforcement and concurrency, project ownership semantics, downgrade behavior, existing-data preservation, admin override, and separation from rate limiting.

**Open decisions referenced here:** [IB-2](open-decisions.md#ib-2--recommendation-gate-point), [IB-7](open-decisions.md#ib-7--admin-bypass-of-entitlement-gates), [IB-12](open-decisions.md#ib-12--soft-deleted-projects-and-the-quota). Text that follows a recommended resolution is provisional until that item is ruled; see [open decisions](open-decisions.md).

---

| Capability / quota | FREE | PRO | PRO_PLUS | Enforced at | Denial |
| --- | --- | --- | --- | --- | --- |
| `quotas.ownedProjects` | 5 | 10 | 20 | `ProjectService.create`, inside its transaction | 403 `UPGRADE_REQUIRED` (+ `details {limit, owned}`) |
| `capabilities.portfolio` (create) | no | yes | yes | `PortfolioPolicy` create chain | 403 `UPGRADE_REQUIRED` |
| `capabilities.portfolio` (public display) | no | yes | yes | `resolvePortfolioPublicEligibility(owner)` → `PortfolioPolicy.canView` | `FEATURE_DISABLED` → 404 at the public boundary (existing) |
| `capabilities.deadlineNotifications` | no | yes | yes | `REGISTRATION_CLOSING` scheduler predicate + handler + delivery re-check | suppressed `NOT_ENTITLED` |
| `capabilities.recommendations` | no | no | yes | `TOP_RELEVANT_COMPETITION` scheduler + `NotificationPolicyService` + delivery (IB-2) | suppressed `NOT_ENTITLED` |
| `capabilities.mcp` | no | no | yes | MCP dispatch after actor resolution | MCP tool failure carrying `UPGRADE_REQUIRED` |

- **Quota enforcement:** in `ProjectService.create`'s existing `$transaction`, first `SELECT pg_advisory_xact_lock(hashtextextended('project-owner-quota:' || $userId, 0))`. Then resolve entitlements with `tx`, count `ProjectMember{userId, role: OWNER, project.deletedAt: null}` (IB-12), and refuse if `owned >= limit`. Then the existing insert of project + `OWNER` member. The lock is local to the transaction, with no external call.
- **Ownership semantics:** unchanged. Only `OWNER` rows count; membership never counts (SB-PL-03). No ownership-transfer or member-add path exists today; if one is added, it must run the same quota check for the new owner.
- **Downgrade:** no deletes or locks. Over-quota users keep every project and only lose creation. Portfolios stay editable and are hidden publicly, with `visibility` untouched. Preferences and MCP tokens are kept.
- **Admin override:** interactive gates call `.platformOverride()` (IB-7). Customers get extra access via an admin grant, never a code path.
- **Separation from rate limiting:** quota lives in services and entitlements; rate limiting stays in `lib/rate-limit` with no billing awareness; the outbound budget is billing-internal. None share configuration.
- **No plan logic in features:** features import `Capability` and `resolveEntitlements` or `hasCapability` only. A lint rule forbids importing `MembershipPlan` outside `lib/entitlements` and `modules/billing`.

---

## Related documents

**In this directory**

- [Effective Access](effective-access.md)
- [Existing Feature Integration](feature-integration.md)
- [Admin Grants](admin-grants.md)
- [Open decisions](open-decisions.md) · [Settled decisions](settled-decisions.md) · [Index](README.md)

**Design and specification**

- [Quotas vs. rate limits (design)](../entitlements/quotas-vs-rate-limits.md)
- [Product — plans](../../../project/feature-specification/subscription/plans.md)
- [Product — data preservation](../../../project/feature-specification/subscription/data-preservation.md)
- [Product — portfolio and entitlements](../../../project/feature-specification/subscription/portfolio-and-entitlements.md)
