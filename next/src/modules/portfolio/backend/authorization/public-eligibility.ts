/**
 * Public-display eligibility — the entitlement gate on showing a portfolio
 * at its public URL (SB-DP-03, IB-5).
 *
 * DISTINCT from `Portfolio.visibility`. `visibility` is the owner's stored
 * preference, and it is the only persisted visibility concept in the
 * schema; nothing may ever mutate it as a side effect of entitlement state.
 * This function is a purely runtime-computed, never-persisted second axis:
 * "is this owner currently entitled to have their portfolio shown publicly
 * at all?"
 *
 * Keyed on the portfolio OWNER, not the viewer — the entitlement that gates
 * public display belongs to whoever owns the portfolio. It is the owner's
 * effective access (the portfolio capability), never their platform role: an
 * administrator's portfolio is public only if they hold the capability too
 * (IB-7).
 *
 * Asynchronous, because effective access is a database read. It is therefore
 * computed BEFORE the context is built (`PortfolioContextResolver.forPublicRead`)
 * and passed in; `PortfolioPolicy` keeps its synchronous shape (IB-5).
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
 * simulate eligibility with vi.mock().
 */
import { Capability, hasCapability } from "@/lib/entitlements";

export async function resolvePortfolioPublicEligibility(params: {
  ownerUserId: string;
}): Promise<boolean> {
  return hasCapability(params.ownerUserId, Capability.PORTFOLIO);
}
