/**
 * Entitlements — Subscription Contribution
 *
 * When a subscription contributes access, as a pure function. This is the
 * in-memory twin of `contributingSubscriptionWhere` (subscription-predicate.ts),
 * the way `grantStateAt` is the twin of `validGrantWhere`: an integration test
 * holds the two to the same answers on shared fixtures.
 *
 * A subscription contributes its plan only when BOTH hold:
 *
 *  - its **phase** is one of `TRIALING`, `ACTIVE` or `PAST_DUE` (SB-EA-06). A
 *    subscription awaiting authentication, `HALTED`, `PAUSED` or in a terminal
 *    phase grants nothing. `PAST_DUE` still contributes: a payment retry in
 *    progress must not cost a customer their access.
 *  - its **provider mode** is the mode this deployment expects (SB-EA-07). A
 *    `TEST` subscription never contributes in a `LIVE`-expected deployment, so
 *    test payments cannot grant production access, and a database copied
 *    between environments cannot either.
 *
 * Nothing here reads a provider status, a Razorpay identifier or a clock:
 * access follows the phase Kizunia has already recorded, so the answer is
 * identical whether or not a provider is configured or reachable.
 *
 * Pure — safe to import from client components.
 */
import type { ProviderMode, SubscriptionPhase } from "@/generated/prisma";

/** The phases in which a subscription contributes its plan. */
export const CONTRIBUTING_PHASES: readonly SubscriptionPhase[] = ["TRIALING", "ACTIVE", "PAST_DUE"];

export interface SubscriptionFacts {
  readonly phase: SubscriptionPhase;
  readonly providerMode: ProviderMode;
}

/**
 * A subscription's contribution, and when it makes none, why:
 * - `CONTRIBUTING` — it grants its plan now
 * - `MODE_MISMATCH` — created in a provider mode this deployment does not expect
 * - `NON_CONTRIBUTING_PHASE` — its phase grants nothing
 *
 * The mode is checked first: a row from the wrong mode is not in a
 * "phase" that matters, it is not this deployment's subscription at all.
 */
export type SubscriptionContribution = "CONTRIBUTING" | "MODE_MISMATCH" | "NON_CONTRIBUTING_PHASE";

export function subscriptionContribution(
  subscription: SubscriptionFacts,
  expectedMode: ProviderMode,
): SubscriptionContribution {
  if (subscription.providerMode !== expectedMode) return "MODE_MISMATCH";
  if (!CONTRIBUTING_PHASES.includes(subscription.phase)) return "NON_CONTRIBUTING_PHASE";

  return "CONTRIBUTING";
}

export function isSubscriptionContributing(
  subscription: SubscriptionFacts,
  expectedMode: ProviderMode,
): boolean {
  return subscriptionContribution(subscription, expectedMode) === "CONTRIBUTING";
}
