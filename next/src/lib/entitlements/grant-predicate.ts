/**
 * Entitlements — Grant Predicates (Prisma)
 *
 * The single database definition of "this grant contributes at `now`". Both
 * the per-user resolver and the set-based predicate are built from it, so the
 * two cannot drift (docs/architecture/subscription/entitlements/
 * effective-access-resolution.md#one-definition-two-shapes). Its in-memory
 * twin is `grantStateAt` in validity.ts.
 */
import type { Prisma } from "@/generated/prisma";

import { EffectivePlan, paidPlansWith, planHasCapability, type Capability } from "./catalog";

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
 * `now`" — for batch consumers (the notification scheduler, in Phase II) that
 * must never call the per-user resolver once per user.
 *
 * Returns `{}` (every user) when FREE already includes the capability. Phase III
 * adds contributing subscriptions as a second `OR` branch.
 */
export function entitledUsersWhere(capability: Capability, now: Date): Prisma.UserWhereInput {
  if (planHasCapability(EffectivePlan.FREE, capability)) return {};

  return {
    entitlementGrants: {
      some: {
        ...validGrantWhere(now),
        plan: { in: paidPlansWith(capability) },
      },
    },
  };
}
