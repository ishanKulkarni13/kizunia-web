/**
 * Entitlements — "what may this user do?"
 *
 * The read-side seam of Subscription & Billing. Every feature asks here, by
 * capability or quota, and never by plan name (SB-PL-02). The billing module
 * owns every write; this module only reads Kizunia's own tables and never
 * imports `modules/billing` or anything provider-related.
 *
 * - `catalog.ts` — the one authoritative plan → capability/quota table (pure)
 * - `validity.ts` — when a grant contributes, derived at read time (pure)
 * - `subscription-contribution.ts` — when a subscription contributes: a
 *   contributing phase, in the deployment's expected provider mode (pure)
 * - `billing-mode.ts` — the expected provider mode, independent of credentials
 * - `grant-predicate.ts` / `subscription-predicate.ts` — the same two rules as
 *   Prisma filters, plus the set-based `entitledUsersWhere` for batch consumers
 * - `resolver.ts` — async, per-user effective access: the highest plan across
 *   grants and subscriptions
 * - `explain.ts` — which sources contributed, and why not
 *
 * This barrel reaches the database. Client components import
 * `@/lib/entitlements/catalog` (or `validity`) directly instead.
 *
 * See docs/architecture/subscription/entitlements/effective-access-resolution.md
 * and docs/architecture/subscription/implementation-plan/phase-I/README.md.
 */

export * from "./catalog";
export * from "./validity";
export { expectedBillingMode } from "./billing-mode";
export {
  CONTRIBUTING_PHASES,
  isSubscriptionContributing,
  subscriptionContribution,
  type SubscriptionContribution,
  type SubscriptionFacts,
} from "./subscription-contribution";
export { contributingSubscriptionWhere } from "./subscription-predicate";
export { validGrantWhere, entitledUsersWhere } from "./grant-predicate";
export {
  resolveEffectiveAccess,
  hasCapability,
  getQuota,
  type EffectiveAccess,
  type EntitlementsDb,
  type ResolveOptions,
} from "./resolver";
export {
  explainEffectiveAccess,
  type AccessExplanation,
  type ExplainedSource,
  type ExplainedGrantSource,
  type ExplainedSubscriptionSource,
  type ExplainedDefaultSource,
} from "./explain";

// -----------------------------------------------------------------------------
// Rate-limit tier (unchanged)
// -----------------------------------------------------------------------------
//
// The rate-limit policy resolver (`lib/rate-limit/resolver.ts`) takes an
// `Entitlements` value as an input and currently ignores it. It stays on this
// synchronous, argument-less default until a plan-tier rate-limit override is
// actually configured, so rate limiting costs no database read per request
// (IB-3, docs/architecture/subscription/implementation/open-decisions.md).
// Paid plans do not relax abuse protection by default.

export type EntitlementTier = "default";

export interface Entitlements {
  readonly tier: EntitlementTier;
}

const DEFAULT_ENTITLEMENTS: Entitlements = { tier: "default" };

/**
 * The rate-limit tier. Always the default: no plan-tier rate-limit override is
 * configured. This is NOT effective access — for that, use
 * `resolveEffectiveAccess`.
 */
export function resolveEntitlements(): Entitlements {
  return DEFAULT_ENTITLEMENTS;
}
