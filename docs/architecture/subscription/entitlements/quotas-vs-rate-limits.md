# Quotas vs. Rate Limits

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24 (decision close-out: IB-3, IB-12)

Two systems, sharing one input (effective access), answering unrelated questions. See
[`../../../project/feature-specification/subscription/glossary.md`](../../../project/feature-specification/subscription/glossary.md#4-quota-vs-rate-limit).
A third, unrelated limit — Kizunia's *outbound* request budget toward Razorpay — is covered in
[`../reconciliation/provider-rate-limits.md`](../reconciliation/provider-rate-limits.md) and shares
nothing with either.

---

## Project ownership quota

Enforced at exactly one point: `ProjectService.create`, immediately after the existing
`PlatformAuthorizer.can(..., CREATE_PROJECT)` check. It counts `ProjectMember` rows with
`role: OWNER` for the acting user and compares against the plan's `ownedProjectLimit` from
[`effective-access-resolution.md`](effective-access-resolution.md). The existing
`countForMember`/`findManyForMember` methods count all memberships regardless of role; a role-filtered
`countOwnedByUser` is a small additive repository change.

**What counts (decided 2026-09-24, [IB-12](../implementation/open-decisions.md#ib-12--soft-deleted-projects-and-the-quota)):**

- `OWNER` memberships whose project has `deletedAt IS NULL`. Deleting a project frees a slot.
- Any future restore or ownership-transfer path must re-check the quota; neither exists today.
- `ProjectMember` gains `@@index([userId, role])` for the count.
- Admins bypass the quota through `.platformOverride()`
  ([IB-7](../implementation/open-decisions.md#ib-7--admin-bypass-of-entitlement-gates)).

**Serialized per user.** Count-then-insert is a check-then-act race: two concurrent creates at 9/10
would both see 9 and both succeed. The count and the insert run in one transaction that first takes a
per-user lock, so concurrent creates for the same user serialize and the second sees 10. **Decided
(IB-12):** a transaction-scoped `pg_advisory_xact_lock` keyed on the user id, taken inside
`ProjectService.create`'s existing transaction before the count. This is the repository's first
advisory lock. It was chosen over `SELECT … FOR UPDATE` on the user row because the projects module
owns no per-user row, and the Better Auth `user` row belongs to authentication. This is a purely local
lock inside one transaction — no external call is made while it is held.

**Downgrade never deletes.** A user over quota after losing access keeps every project; only new
owned projects are refused ([data preservation](../../../project/feature-specification/subscription/data-preservation.md#projects)).

## Rate limiting

Unrelated. `lib/rate-limit/resolver.ts`'s `resolvePolicy(policyId, subject, entitlements)` already
receives an `entitlements` parameter (currently ignored), with documented precedence: per-subject
override → organization override → plan-tier override → registry default. **Decided 2026-09-24 ([IB-3](../implementation/open-decisions.md#ib-3--entitlement-resolver-signature)):
rate limiting is unchanged in V1.** The existing synchronous, argument-less `resolveEntitlements()`
keeps returning the default tier to the rate-limit service. The per-user effective-access API is
async and database-backed, and is wired into rate limiting only when a plan-tier override is actually
configured. *Superseded text:* "implementing effective access and passing its result through
activates plan-tier overrides with zero call-site changes". That is not possible, because the current
function takes no user and is synchronous.

**Default is no difference.** A plan gets a higher request rate only where a plan-tier override is
explicitly configured for a specific policy; otherwise every plan uses the registry default. Paying
does not relax abuse protection.

**Cost.** Resolving entitlements for a rate-limit decision is two indexed reads per authenticated
request (memoized within the request). Unauthenticated subjects never resolve entitlements.

## Why they never merge

A future "unlimited projects" plan still respects an *operational* rate/volume ceiling — unrelated to
the product-facing quota being removed ([`../../../project/feature-specification/subscription/future.md`](../../../project/feature-specification/subscription/future.md#more-plans-including-an-unlimited-tier)).
Razorpay is never made aware of rate limits, and rate limiting never depends on Razorpay being
reachable — only on the already-resolved, Razorpay-independent effective access.
