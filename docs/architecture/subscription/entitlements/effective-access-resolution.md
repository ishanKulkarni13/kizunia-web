# Effective Access Resolution

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24 (decision close-out: IB-3)

The real implementation of `lib/entitlements/index.ts`'s `resolveEntitlements()`, replacing its
current `{tier: "default"}` stub. This is the one function every seam in
[`authorization-integration.md`](authorization-integration.md) ultimately calls.

---

## The resolution

```text
resolveEffectiveAccess(userId, now):
  subscriptionTier = max(plan) over Subscription
                       where userId
                         and phase in CONTRIBUTING            -- TRIALING, ACTIVE, PAST_DUE
                         and providerMode = expectedBillingMode   -- SB-EA-07
  grantTier        = max(plan) over EntitlementGrant
                       where userId and status = ACTIVE
                         and validFrom <= now and (validUntil is null or now < validUntil)
  return max(subscriptionTier, grantTier, FREE)
```

- **Maximum over every contributing Subscription**, never "the current one"
  ([SB-EA-06](../../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-06--effective-access-takes-the-maximum-over-every-contributing-subscription)).
  If two open subscriptions ever exist, the result is still deterministic and never below what the
  user pays for ([`../lifecycle/multiple-subscriptions.md`](../lifecycle/multiple-subscriptions.md#detection)).
- **Mode filter.** A Subscription contributes only if its provider mode equals the deployment's
  expected billing mode — `live` in production, `test` elsewhere — regardless of whether credentials
  are currently configured
  ([SB-EA-07](../../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-07--a-subscription-contributes-only-in-the-provider-mode-it-was-created-in)).
- **Grant expiry is evaluated, never written**
  ([SB-EA-09](../../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-09--grant-expiry-is-derived-when-read-never-written-by-a-read)).
- **No time-based decay of paid access.** A contributing phase keeps contributing until a sync
  changes it — including past `current_end` if a sync is overdue. Access never ends because Kizunia
  could not observe Razorpay ([`../provider-availability/outage-and-stale-state.md`](../provider-availability/outage-and-stale-state.md));
  overdue syncs are alerted instead.

Both reads are indexed queries against Kizunia's own tables (`(userId, phase)` and
`(userId, status, validUntil)`). No Razorpay call ever happens during resolution, which is why it
works identically in `disabled`, `test` and `live`. A user who never started a checkout reads two
empty index ranges.

## One definition, two shapes

The notification scheduler (and any other batch consumer) must decide eligibility for many users at
once. Calling `resolveEffectiveAccess` per user would be N round trips; re-implementing the rule in a
query would let the two drift. The rule is therefore defined once as a **set-based predicate** — a
query fragment (or database view) "users whose effective access includes capability C at time t" —
and both the per-user resolver and batch consumers are built from it. Tests assert that the two agree
on the same fixtures.

## Consumed as capabilities, not as a tier alone

The resolved tier is translated through the static plan → capability mapping from
[`../../../project/feature-specification/subscription/plans.md`](../../../project/feature-specification/subscription/plans.md)
into the answer a caller needs (`canCreatePortfolio`, `ownedProjectLimit`, …).

## Caching

A request-scoped memo of the result is fine (the same user is asked about several times per request).
No cross-request cache exists, so there is no invalidation problem: a committed sync *is* the access
change. If a cross-request cache is ever added, it must be invalidated by the sync apply transaction
and by grant writes, or its TTL becomes a documented staleness bound.

## Determinism under races

Resolution reads committed rows only. A sync that changes a phase and a request that resolves access
concurrently see either the old or the new state, both of which were true at some instant. The only
decisions that must be serialized against access changes are those that *write* based on access —
the project-quota check ([`quotas-vs-rate-limits.md`](quotas-vs-rate-limits.md#project-ownership-quota)).

## What changes when this ships

*Original expectation (superseded 2026-09-24):* per the existing comments in
`lib/entitlements/index.ts` and `lib/rate-limit/resolver.ts`, only the body of `resolveEntitlements()`
would change.

**Decided ([IB-3](../implementation/open-decisions.md#ib-3--entitlement-resolver-signature)):** that
function is synchronous and takes no user, so a per-user, database-backed resolver needs a new
signature.

- `lib/entitlements` gains a **new async per-user API**: effective access for a user, capability and
  quota questions, the set-based predicate, and explain. Every feature gate consumes it.
- The existing `resolveEntitlements()` stays as the rate-limit registry's default-tier input until a
  plan-tier override is configured.
- Exact names are chosen in implementation-plan [Phase I](../implementation-plan/phase-I/README.md).
