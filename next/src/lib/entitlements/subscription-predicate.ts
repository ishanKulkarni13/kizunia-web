/**
 * Entitlements — Subscription Predicate (Prisma)
 *
 * The single database definition of "this subscription contributes". Both the
 * per-user resolver and the set-based `entitledUsersWhere` are built from it,
 * so the two cannot drift; its in-memory twin is `subscriptionContribution` in
 * subscription-contribution.ts (docs/architecture/subscription/entitlements/
 * effective-access-resolution.md#one-definition-two-shapes).
 *
 * Served by the `(userId, phase)` index on `subscription`.
 */
import type { Prisma, ProviderMode } from "@/generated/prisma";

import { CONTRIBUTING_PHASES } from "./subscription-contribution";

/** `phase` is a contributing phase and `providerMode` is the deployment's expected mode. */
export function contributingSubscriptionWhere(
  expectedMode: ProviderMode,
): Prisma.SubscriptionWhereInput {
  return {
    providerMode: expectedMode,
    phase: { in: [...CONTRIBUTING_PHASES] },
  };
}
