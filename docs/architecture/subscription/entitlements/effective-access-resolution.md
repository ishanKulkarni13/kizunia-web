# Effective Access Resolution

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

The real implementation of `lib/entitlements/index.ts`'s `resolveEntitlements()`, replacing its
current `{tier: "default"}` stub. This is the one function every seam in
[`authorization-integration.md`](authorization-integration.md) ultimately calls.

---

## The resolution

```text
resolveEffectiveAccess(userId):
  subscriptionTier  = currentSubscriptionPhase(userId) contributes-to-access ? its plan : FREE
                      (state-mapping.md decides which phases contribute)
  grantTier         = max(plan) over EntitlementGrant where userId, status = ACTIVE,
                       now within [validFrom, validUntil or +inf)
  return max(subscriptionTier, grantTier, FREE)
```

Both reads are plain, indexed queries against Kizunia's own tables — no Razorpay call happens during
resolution. This is what makes effective-access resolution work identically whether the billing
provider is disabled, in test mode, or live: it never asks Razorpay anything.

## Consumed as capabilities, not as a tier alone

The resolved tier is immediately translated through the static plan → capability mapping from
[`../../../project/feature-specification/subscription/plans.md`](../../../project/feature-specification/subscription/plans.md)
into the actual answer a caller needs (`canCreatePortfolio: boolean`, `ownedProjectLimit: number`,
...). Callers ask for a capability; the tier itself is an implementation detail of how the
capability was derived.

## Caching

A short-lived, request-scoped cache of the resolved result is a reasonable implementation
optimization (the same user's effective access is asked for multiple times within one request across
different authorization checks). It is never treated as a source of truth beyond the request that
computed it — see [SB-EA-05](../../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-05--feature-code-checks-capabilities-never-razorpay-derived-fields-directly).

## What changes when this ships

Per the existing comment in `lib/entitlements/index.ts` and `lib/rate-limit/resolver.ts`: only the
body of `resolveEntitlements()`. Every call site that already consumes its result — including both
MCP rate-limit policies — activates plan-aware behavior with zero changes of its own. This is the
entitlement-readiness the authorization audit confirmed
(`kizunia-authorization-compressed-wind.md` §20).
