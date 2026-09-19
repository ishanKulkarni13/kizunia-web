/**
 * Entitlements — "what limits does this customer get?"
 *
 * A sibling of `lib/rate-limit`, not a child of it. This is deliberately
 * the entire entitlements system for V1: one type and one function that
 * always returns the default tier. There is no `Plan`/`Subscription` model
 * in the schema yet (see the audit), and the codebase's own authorization
 * layer already reserves this exact seam — see the comment on
 * `PlatformAction.CREATE_PORTFOLIO` in
 * `src/authorization/platform/permission-set.ts`, which calls out that
 * "there is no subscription/plan system yet" and that a future one will
 * plug in without touching call sites.
 *
 * The rate-limit policy resolver (`lib/rate-limit/resolver.ts`) takes an
 * `Entitlements` value as an input. The day a real `Plan` model exists,
 * `resolveEntitlements` below is the only function whose body changes —
 * no controller, service, or policy call site is touched.
 */

export type EntitlementTier = "default";

export interface Entitlements {
  readonly tier: EntitlementTier;
}

const DEFAULT_ENTITLEMENTS: Entitlements = { tier: "default" };

/**
 * Resolves the caller's entitlements. Always the default tier today —
 * there is nothing yet to distinguish one caller's limits from another's.
 */
export function resolveEntitlements(): Entitlements {
  return DEFAULT_ENTITLEMENTS;
}
