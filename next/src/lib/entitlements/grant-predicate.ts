/**
 * Entitlements — Grant Predicates (Prisma)
 *
 * The single database definition of "this grant contributes at `now`", and the
 * set-based `entitledUsersWhere` built on it and on the subscription predicate.
 * Both the per-user resolver and the set-based predicate are built from the same
 * definitions, so the two cannot drift (docs/architecture/subscription/entitlements/
 * effective-access-resolution.md#one-definition-two-shapes). Its in-memory
 * twin is `grantStateAt` in validity.ts.
 */
import type { Prisma, ProviderMode } from "@/generated/prisma";

import { expectedBillingMode } from "./billing-mode";
import { EffectivePlan, paidPlansWith, planHasCapability, type Capability } from "./catalog";
import { contributingSubscriptionWhere } from "./subscription-predicate";

/** `status = ACTIVE` and `validFrom <= now` and (`validUntil` is null or `validUntil > now`). */
export function validGrantWhere(now: Date): Prisma.EntitlementGrantWhereInput {
  return {
    status: "ACTIVE",
    validFrom: { lte: now },
    OR: [{ validUntil: null }, { validUntil: { gt: now } }],
  };
}

/**
 * The set-based form: "users whose effective access includes `capability` at
 * `now`" — for batch consumers (the notification scheduler) that must never
 * call the per-user resolver once per user.
 *
 * Built from the same two predicates as the resolver, one per source, joined
 * with `OR`: a user qualifies through a valid grant OR a contributing
 * subscription of the expected mode, either at a plan that includes the
 * capability. Returns `{}` (every user) when FREE already includes it.
 *
 * The result carries a top-level `OR`. Spread it beside unrelated keys (as the
 * scheduler and the tests do), but compose it with `AND: [...]` rather than
 * spreading it beside another `OR`, which would overwrite it.
 */
export function entitledUsersWhere(
  capability: Capability,
  now: Date,
  expectedMode: ProviderMode = expectedBillingMode(),
): Prisma.UserWhereInput {
  if (planHasCapability(EffectivePlan.FREE, capability)) return {};

  const plans = { in: paidPlansWith(capability) };

  return {
    OR: [
      { entitlementGrants: { some: { ...validGrantWhere(now), plan: plans } } },
      { subscriptions: { some: { ...contributingSubscriptionWhere(expectedMode), plan: plans } } },
    ],
  };
}
