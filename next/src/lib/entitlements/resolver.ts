/**
 * Entitlements — Effective Access Resolver
 *
 * "What may this user do?" — the one read-side seam every feature consumes.
 *
 *   effective access = max(plan) over the user's contributing sources, else FREE
 *
 * Phase I sources: entitlement grants. Phase III adds contributing
 * subscriptions of the expected billing mode as a second `max` input; callers
 * do not change.
 *
 * Read-only by design: no writes (grant expiry is derived, SB-EA-09), no
 * locks, no cache, no provider call. It reads Kizunia's own tables only, so it
 * behaves identically whether or not a payment provider is configured.
 *
 * `db` accepts a transaction client so a feature can resolve access inside the
 * same transaction as the write that depends on it (the project quota).
 */
import type { Prisma, PrismaClient } from "@/generated/prisma";
import prisma from "@/lib/prisma";

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

export type EntitlementsDb = PrismaClient | Prisma.TransactionClient;

export interface ResolveOptions {
  /** The instant access is evaluated at. Defaults to now. */
  readonly now?: Date;
  readonly db?: EntitlementsDb;
}

export interface EffectiveAccess extends PlanAccess {
  readonly userId: string;
}

async function resolvePlan(userId: string, options: ResolveOptions): Promise<EffectivePlan> {
  const now = options.now ?? new Date();
  const db = options.db ?? prisma;

  const grants = await db.entitlementGrant.findMany({
    where: { userId, ...validGrantWhere(now) },
    select: { plan: true },
  });

  return maxPlan(grants.map((grant) => grant.plan));
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
