/**
 * Entitlements — Effective Access Resolver
 *
 * "What may this user do?" — the one read-side seam every feature consumes.
 *
 *   effective access = max(plan) over the user's contributing sources, else FREE
 *
 * Sources, each an input to the `max`:
 *
 *  - entitlement **grants** (admin grants, and later promotions), valid at `now`;
 *  - **subscriptions** in a contributing phase (`TRIALING`, `ACTIVE`,
 *    `PAST_DUE`) that were created in the deployment's *expected* billing mode.
 *    A `TEST` subscription contributes nothing in a `LIVE`-expected deployment
 *    (SB-EA-07).
 *
 * The highest plan across every source wins (SB-EA-02/03/06), and callers never
 * learn which source it was: adding a source changes no feature code.
 *
 * Read-only by design: no writes (grant expiry is derived, SB-EA-09), no
 * locks, no cache, no provider call. It reads Kizunia's own tables only, and a
 * subscription contributes by the phase Kizunia has already recorded, so the
 * answer is identical whether or not a payment provider is configured,
 * reachable, or in an outage.
 *
 * `db` accepts a transaction client so a feature can resolve access inside the
 * same transaction as the write that depends on it (the project quota).
 */
import type { Prisma, PrismaClient, ProviderMode } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { expectedBillingMode } from "./billing-mode";
import {
  accessForPlan,
  maxPlan,
  planHasCapability,
  quotaFor,
  type Capability,
  type EffectivePlan,
  type PlanAccess,
  type Quota,
} from "./catalog";
import { validGrantWhere } from "./grant-predicate";
import { contributingSubscriptionWhere } from "./subscription-predicate";

export type EntitlementsDb = PrismaClient | Prisma.TransactionClient;

export interface ResolveOptions {
  /** The instant access is evaluated at. Defaults to now. */
  readonly now?: Date;
  readonly db?: EntitlementsDb;
  /**
   * Which provider mode's subscriptions count. Defaults to the deployment's
   * expected mode (`expectedBillingMode`); the override exists so a test can
   * exercise both sides of the TEST/LIVE isolation in one process.
   */
  readonly expectedMode?: ProviderMode;
}

export interface EffectiveAccess extends PlanAccess {
  readonly userId: string;
}

async function resolvePlan(userId: string, options: ResolveOptions): Promise<EffectivePlan> {
  const now = options.now ?? new Date();
  const db = options.db ?? prisma;

  const expectedMode = options.expectedMode ?? expectedBillingMode();

  // Sequential, not `Promise.all`: `db` may be a transaction client, and two
  // small indexed reads cost nothing next to a connection round trip.
  const grants = await db.entitlementGrant.findMany({
    where: { userId, ...validGrantWhere(now) },
    select: { plan: true },
  });

  const subscriptions = await db.subscription.findMany({
    where: { userId, ...contributingSubscriptionWhere(expectedMode) },
    select: { plan: true },
  });

  return maxPlan([...grants, ...subscriptions].map((source) => source.plan));
}

export async function resolveEffectiveAccess(
  userId: string,
  options: ResolveOptions = {},
): Promise<EffectiveAccess> {
  const plan = await resolvePlan(userId, options);

  return { userId, ...accessForPlan(plan) };
}

export async function hasCapability(
  userId: string,
  capability: Capability,
  options: ResolveOptions = {},
): Promise<boolean> {
  return planHasCapability(await resolvePlan(userId, options), capability);
}

export async function getQuota(
  userId: string,
  quota: Quota,
  options: ResolveOptions = {},
): Promise<number> {
  return quotaFor(await resolvePlan(userId, options), quota);
}
