# Phase I — Entitlement Foundation and Admin Grants

> **Status:** Not started
>
> **Depends on:** — (first phase) · **Razorpay needed:** no · **Old slices:** S1, S2

## Objective

Make **effective access** real, without any provider. After this phase Kizunia can answer "what may this user do?" from its own tables, administrators can grant and revoke paid access with a full audit trail, and every later phase has one read-side seam to consume.

## Scope

- The plan and capability catalog: Free, Pro and Pro+ with quotas and capabilities exactly as in [`plans.md`](../../../../project/feature-specification/subscription/plans.md).
- A new **async, per-user effective-access API** in `lib/entitlements` ([IB-3](../../implementation/open-decisions.md#ib-3--entitlement-resolver-signature)):
  - effective access for a user;
  - capability and quota questions;
  - the **set-based** predicate for background queries;
  - an explain function.
- Grant persistence and lifecycle: create, extend and revoke, with append-only audit and derived expiry ([admin grants](../../entitlements/admin-grants.md)).
- Billing platform actions and role assignment ([IB-15](../../implementation/open-decisions.md#ib-15--billing-admin-roles)).
- Admin grant API routes and a minimal admin UI to list, create, extend and revoke grants.
- `GET /api/v1/me/entitlements`: the server-computed capability and quota flags for the signed-in user.
- The `modules/billing` skeleton: the directory layout from [architecture fit](../../implementation/architecture-fit.md#where-subscriptions-belong), `observability/log.ts` (`[billing] {json}`), and billing error classes extending `AppError`.

## Architectural components involved

`lib/entitlements` (the read seam); `modules/billing/backend/grants` (the write side for grants); `authorization/platform` (actions and permission set); the existing `AuthorizationEvaluator`, `PlatformAuthorizer`, `Route.execute` and `ErrorHandler`.

## Dependencies

None. This phase must not depend on any Razorpay concept.

## Files and modules likely affected

Paths are relative to `next/src/`.

- `lib/entitlements/*`: catalog, resolver, set predicate, explain.
- `modules/billing/{backend/grants,observability,errors,schemas,dto}/*`, plus a controller and admin controller for grants.
- `authorization/platform/{actions,permission-set}.ts`.
- `app/api/v1/admin/billing/grants/**` and `app/api/v1/me/entitlements/route.ts`.
- `app/(dashboard)/admin/billing/grants/**`: a minimal UI.
- `prisma/schema.prisma` and one migration, with hand-written CHECKs.
- `lib/rate-limit/*` is **not** changed. `resolveEntitlements()` keeps returning the default tier (IB-3).

## Database and schema work

Per the [persistence boundary](../README.md#persistence-boundary):

- Enums `MembershipPlan` (`PRO`, `PRO_PLUS`; `FREE` is unrepresentable), `EntitlementSource` (**`ADMIN_GRANT` only**), `GrantStatus`, `GrantAuditAction`.
- `EntitlementGrant` and `GrantAuditEntry` as in [database design](../../implementation/database-design.md#models), **without** `promotionId` (Phase VII adds it):
  - nullable `userId`, FK `onDelete: Restrict`, plus `subjectPseudonym` ([IB-14](../../implementation/open-decisions.md#ib-14--account-removal-storage));
  - actor columns (`grantedByUserId`, `performedByUserId`, `revokedByUserId`) as plain strings, not FKs;
  - CHECKs: `validUntil IS NULL OR validUntil > validFrom`, and no self-grant for `ADMIN_GRANT`;
  - index `(userId, status, validUntil)`.

## Domain and application work

- **Catalog:** `plan → {capabilities, quotas}`, with plan ordering. Capabilities: portfolio, deadline notifications, recommendations, MCP. Quota: owned projects. Moving a capability between plans must be a data change.
- **Resolver:** effective access = the maximum over valid grants. Subscriptions are added in Phase III. `FREE` is the default. Grant validity is **derived** at read time (`validFrom <= now < validUntil`, status `ACTIVE`) and never written by a read (SB-EA-09).
- **Set form:** "users whose effective access includes capability C at time t", built from the same definition as the per-user form, so the two cannot drift ([effective-access resolution](../../entitlements/effective-access-resolution.md#one-definition-two-shapes)).
- **Explain:** for a user, which sources contribute and why. Admins read it later (VIII); it is built here because it is part of the resolver's contract.
- **Grants:**
  - create, extend and revoke, each in one transaction with a `GrantAuditEntry`;
  - a reason is required;
  - self-grants are refused in the service (and by the CHECK);
  - revocation is recorded, never a delete.

## Provider work

None.

## Integration work

- `GET /api/v1/me/entitlements` returns capability and quota flags. The UI never computes access.
- Admin routes sit behind the existing admin layout guard, and every API route re-authorizes.

## Authorization and entitlement implications

- New platform actions: `MANAGE_ENTITLEMENT_GRANTS`, `VIEW_BILLING`, `MANAGE_BILLING`.
- **Roles (product decision (owner), IB-15):** `SUPER_ADMIN` holds all three; `ADMIN` holds `VIEW_BILLING` (it can list and view grants); `MODERATOR` and `USER` hold none.
- Granting uses `PlatformAuthorizer.can(…, MANAGE_ENTITLEMENT_GRANTS)` with **no** `platformOverride`.
- Admin bypass of feature gates is **not** part of this phase (Phase II) and is never an entitlement source (SB-EA-04).

## Concurrency and transaction considerations

- Grant writes and their audit entry are committed together.
- Concurrent extend and revoke on one grant: both are audited, and the final state is whichever committed last. Use a row lock or a conditional update, so an extend never resurrects a revoked grant.
- The resolver is read-only and takes no locks. It accepts an optional transaction client so Phase II can read inside a feature's transaction.

## Observability requirements

- `[billing]` structured log events `grant.created|extended|revoked`, carrying actor, target, plan, validity and reason; no secrets.
- The explain function doubles as a support diagnostic.

## Testing requirements

**Unit:**
- the catalog matches `plans.md` exactly;
- effective access is the max over sources;
- grant window edges (`validFrom == now`, `validUntil == now`);
- the `FREE` default;
- the set form agrees with the per-user form on shared fixtures.

**Integration:**
- a self-grant is refused, by the service and by the DB CHECK;
- create, extend and revoke are audited;
- concurrent revoke and extend: both audited, never resurrected;
- expiry is by clock only, with no writes;
- a hard delete of a user with a grant is refused by `Restrict`;
- the role matrix for each action.

## Acceptance criteria

- [ ] A `SUPER_ADMIN` can grant Pro or Pro+ for a duration or indefinitely, extend it, and revoke it. Each action produces an audit entry with a reason.
- [ ] An `ADMIN` can view grants but cannot create, extend or revoke them. A `MODERATOR` cannot see them.
- [ ] Nobody can grant to themselves.
- [ ] `GET /me/entitlements` reflects a grant immediately and falls back to Free when it expires, with no job running.
- [ ] The set-based predicate and the per-user API agree on a shared fixture set.
- [ ] Rate limiting behaves exactly as before.
- [ ] No file in this phase imports anything Razorpay-related.

## Explicit non-goals

- Any feature gate (Phase II).
- Subscriptions, Razorpay, checkout.
- Promotions (Phase VII).
- Plan-tier rate limits.
- The pseudonymization workflow (deferred).

## Decisions that must already be settled

IB-3 (resolver signature), IB-14 (storage), IB-15 (roles), SB-EA-01…09, SB-PL-01…05. **All are DECIDED.**

## Risks and blockers

- **Risk:** the set-based and per-user forms drift. Mitigation: one shared definition, plus the agreement test.
- **Risk:** an admin with no second admin cannot get notification access (self-grants are forbidden). That is accepted by IB-7; the runbook notes it.
- **Blockers:** none.

## Expected output

The catalog and the async resolver in `lib/entitlements`; grant schema and migration; the grant service, API and minimal admin UI; the billing platform actions and roles; `GET /me/entitlements`; the `modules/billing` skeleton with logging and errors; tests.
