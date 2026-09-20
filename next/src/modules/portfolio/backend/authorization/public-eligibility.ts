/**
 * Public-display eligibility — the seam a future Plan/Entitlement system
 * will gate.
 *
 * DISTINCT from `Portfolio.visibility`. `visibility` is the owner's stored
 * preference, and it is the only persisted visibility concept in the
 * schema; nothing may ever mutate it as a side effect of entitlement state.
 * This function is a purely runtime-computed, never-persisted second axis:
 * "is this owner currently entitled to have their portfolio shown publicly
 * at all?"
 *
 * Keyed on the portfolio OWNER, not the viewer — the entitlement that gates
 * public display belongs to whoever owns the portfolio.
 *
 * Every owner is eligible today — there is no subscription/plan system yet
 * (see `resolveEntitlements()` in src/lib/entitlements/index.ts, and the
 * CREATE_PORTFOLIO baseline-grant comment in
 * src/authorization/platform/permission-set.ts, which documents the same
 * kind of seam). When a real entitlement system exists, this function's
 * BODY is the only thing that changes — no policy, context resolver,
 * service, repository, controller or route call site needs to change.
 *
 * Losing eligibility hides the portfolio from the public read path and
 * nothing else: the data is never deleted, the owner can always still view
 * and edit it, and regaining eligibility restores public display
 * automatically from the existing stored `visibility` — no re-opt-in, no
 * data rebuild.
 *
 * Denials on this axis surface as AuthorizationCode.FEATURE_DISABLED (see
 * PortfolioPolicy.canView), distinct from AuthorizationCode.RESOURCE_PRIVATE
 * for `visibility !== PUBLIC`.
 *
 * Kept a plain exported function with no module-level state so tests can
 * simulate "entitlement inactive" with vi.mock().
 */
export function resolvePortfolioPublicEligibility(_params: {
  ownerUserId: string;
}): boolean {
  return true;
}
