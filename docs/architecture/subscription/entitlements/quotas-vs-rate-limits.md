# Quotas vs. Rate Limits

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

Two systems, sharing one input (effective access), answering unrelated questions. See
[`../../../project/feature-specification/subscription/glossary.md`](../../../project/feature-specification/subscription/glossary.md#4-quota-vs-rate-limit).

---

## Project ownership quota

Enforced at exactly one point: `ProjectService.create`, immediately after the existing
`PlatformAuthorizer.can(..., CREATE_PROJECT)` check and before the creating transaction — the same
insertion point the authorization audit already identified
(`kizunia-authorization-compressed-wind.md` §6). It requires counting `ProjectMember` rows scoped to
`role: OWNER` for the acting user, compared against the plan's `ownedProjectLimit` capability from
[`effective-access-resolution.md`](effective-access-resolution.md). The existing
`countForMember`/`findManyForMember` repository methods count all memberships regardless of role and
need a role-filtered variant (or a new `countOwnedByUser` method) — a small, additive repository
change, not a redesign.

## Rate limiting

Unrelated. `lib/rate-limit/resolver.ts`'s `resolvePolicy(policyId, subject, entitlements)` already
receives an `entitlements` parameter, currently ignored (`void entitlements`), with an existing
comment documenting the intended precedence: per-subject override → organization override → plan-tier
override → registry default. Implementing [`effective-access-resolution.md`](effective-access-resolution.md)
and passing its result through this parameter activates plan-aware rate limits at every one of the
existing ~20 policies (including both MCP policies) with zero call-site changes — exactly the seam
the resolver was already built to receive.

## Why they never merge

A future "unlimited projects" plan is still expected to respect an *operational* rate/volume
safety ceiling — unrelated to the product-facing quota being removed. See
[`../../../project/feature-specification/subscription/future.md`](../../../project/feature-specification/subscription/future.md#more-plans-including-an-unlimited-tier).
Razorpay is never made aware of rate limits, and rate limiting never depends on Razorpay being
reachable — it depends only on the already-resolved, Razorpay-independent effective access.
