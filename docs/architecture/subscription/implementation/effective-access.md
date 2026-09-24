# Effective Access

> **Status:** Implementation plan — not implemented
>
> **Last Updated:** 2026-09-24
>
> **Blueprint section:** §12 (see the [section map](README.md#blueprint-section-map))

How effective access is computed (highest currently valid access across subscriptions and grants, per provider mode, with no provider call) and how it becomes capabilities, quotas and feature authorization through the existing entitlement resolver and `AuthorizationEvaluator` chains.

**Decisions referenced here:** [IB-7](open-decisions.md#ib-7--admin-bypass-of-entitlement-gates). All were ruled on 2026-09-24; see [open decisions](open-decisions.md) for each ruling and who made it (product decision (owner) or architecture decision (autonomous)).

---

```text
resolveEntitlements(userId, { now = new Date(), db = prisma }) -> Entitlements
  subs   = db.subscription.findMany({ where: { userId, phase: in CONTRIBUTING, providerMode: expectedBillingMode() },
                                      select: { plan } })                        -- index (userId, phase)
  grants = db.entitlementGrant.findMany({ where: { userId, status: ACTIVE, validFrom <= now,
                                                   OR: [validUntil null, validUntil > now] }, select: { plan } })
  plan   = max(FREE, ...subs.plan, ...grants.plan)
  return { plan, capabilities: CATALOG[plan].capabilities, quotas: CATALOG[plan].quotas }
```

- Covers FREE, paid, multiple subscription records (max, SB-EA-06), admin grants and promotions (grant sources), mode (`expectedBillingMode()`, SB-EA-07), grant expiry (read-time), lifecycle (the contributing set), and "highest currently valid". No time decay of paid access; no provider call; identical in `disabled`/`test`/`live`.
- **Future sources:** add another `max` input, for example one-time purchases.
- **Set-based form:** `entitledUsersWhere(capability, now): Prisma.UserWhereInput` builds `OR[ subscriptions.some{phase∈C, mode, plan∈plansWith(cap)}, entitlementGrants.some{…valid, plan∈plansWith(cap)} ]`. If `FREE` has the capability it returns `{}`. Both forms derive from `plansWith(cap)` and `CONTRIBUTING`; a shared fixture test asserts they agree.
- **`explainEffectiveAccess(userId, at?)`:** billing-admin only; lists each source, whether it contributed and why not.
- **Memoization:** optional request-scoped memo. No cross-request cache, so no invalidation problem.

**From effective access to feature authorization:**

```text
effective access (plan) -> capabilities / quotas (catalog) -> the feature's EXISTING policy chain:
  AuthorizationEvaluator.start(ctx).security(banned).platformOverride()
    .require(ctx => ctx.entitlements.capabilities.X, UPGRADE_REQUIRED, "...")   <- the one new input
    ...existing rules... .grant().evaluate()
  -> Authorization.assert -> ForbiddenError(403, code UPGRADE_REQUIRED)
Background (no actor): hasCapability(userId, X) / entitledUsersWhere(X)   (no bypass; IB-7)
```

Denial codes: `UPGRADE_REQUIRED` when a higher plan grants it; `FEATURE_DISABLED` for public-portfolio display (existing usage). `PlatformAccess.canBypassAuthorization` stays orthogonal. It never makes an admin "PRO_PLUS" (SB-EA-04); it only short-circuits interactive chains that already call `.platformOverride()`.

---

## Related documents

**In this directory**

- [Entitlements and Quotas](entitlements-and-quotas.md)
- [Admin Grants](admin-grants.md)
- [Existing Feature Integration](feature-integration.md)
- [Open decisions](open-decisions.md) · [Settled decisions](settled-decisions.md) · [Index](README.md)

**Design and specification**

- [Effective access resolution (design)](../entitlements/effective-access-resolution.md)
- [Environments (provider mode)](../provider-availability/environments.md)
- [Product — entitlements and effective access](../../../project/feature-specification/subscription/entitlements-and-effective-access.md)
