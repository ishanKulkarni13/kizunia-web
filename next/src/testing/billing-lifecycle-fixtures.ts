/**
 * Fixtures for the Phase VI lifecycle command integration tests (cancel,
 * admin cancel, supersession, plan change).
 *
 * A lifecycle command acts on a subscription that already exists at the
 * provider and in Kizunia. `seedLive` writes both sides consistently: the
 * fake provider's store (status, plan, period, notes naming the Kizunia row)
 * and the bound `Subscription` row in the phase that status maps to, with an
 * observation watermark in the past so the command's own observations apply.
 */
import type { BillingCycle, MembershipPlan, Prisma, SubscriptionKind, SubscriptionPhase } from "@/generated/prisma";
import prisma from "@/lib/prisma";
import { createPlanCatalog } from "@/modules/billing/config/plan-catalog";
import type { FakeBillingProvider } from "@/modules/billing/provider/fake-provider";
import type { ProviderSubscriptionState } from "@/modules/billing/provider/types";

import { insertBoundSubscription, providerSubscriptionIdFor } from "./billing-sync-fixtures";

const DAY = 24 * 60 * 60 * 1000;

/** The fake's plan IDs, priced like the TEST verification plans (IB-24 item 13), in paise. */
export const LIFECYCLE_PRICES: Readonly<Record<`${MembershipPlan}/${BillingCycle}`, number>> = {
  "PRO/MONTHLY": 1000,
  "PRO/YEARLY": 1200,
  "PRO_PLUS/MONTHLY": 2000,
  "PRO_PLUS/YEARLY": 2200,
};

export function fakePlanId(plan: MembershipPlan, cycle: BillingCycle): string {
  return `plan_fake_${plan}_${cycle}`;
}

/** Every plan the fake issues, with prices, so upgrade and downgrade are decidable. */
export const lifecycleCatalog = createPlanCatalog(
  (["PRO", "PRO_PLUS"] as const).flatMap((plan) =>
    (["MONTHLY", "YEARLY"] as const).map((cycle) => ({
      providerPlanId: fakePlanId(plan, cycle),
      plan,
      cycle,
      amountMinor: LIFECYCLE_PRICES[`${plan}/${cycle}`],
    })),
  ),
);

/** The provider status each phase is observed as (state-mapping.md). */
const STATUS_FOR: Partial<Record<SubscriptionPhase, string>> = {
  PENDING_AUTHENTICATION: "created",
  TRIALING: "authenticated",
  ACTIVE: "active",
  PAST_DUE: "pending",
  HALTED: "halted",
  PAUSED: "paused",
  CANCELLED: "cancelled",
};

export interface SeedLiveOptions {
  readonly phase: SubscriptionPhase;
  readonly plan?: MembershipPlan;
  readonly cycle?: BillingCycle;
  readonly now: Date;
  readonly advisoryPaymentMethod?: string | null;
  readonly advisoryInternationalCard?: boolean | null;
  /** Extra provider-side fields (a scheduled change flag, a period). */
  readonly provider?: Partial<ProviderSubscriptionState>;
  /** Extra Kizunia-side fields. */
  readonly row?: Partial<Prisma.SubscriptionUncheckedCreateInput>;
}

export async function seedLive(fake: FakeBillingProvider, userId: string, options: SeedLiveOptions) {
  const { phase, now } = options;
  const plan = options.plan ?? "PRO";
  const cycle = options.cycle ?? "MONTHLY";
  const kind: SubscriptionKind = phase === "TRIALING" ? "TRIAL" : "STANDARD";
  const periodEnd = new Date(now.getTime() + 20 * DAY);
  const providerSubscriptionId = providerSubscriptionIdFor(userId.slice(0, 12));

  const row = await insertBoundSubscription(userId, {
    kind,
    phase,
    plan,
    cycle,
    providerSubscriptionId,
    providerPlanId: fakePlanId(plan, cycle),
    providerStatus: STATUS_FOR[phase] ?? null,
    currentPeriodStart: new Date(periodEnd.getTime() - 30 * DAY),
    currentPeriodEnd: periodEnd,
    startAt: phase === "TRIALING" ? new Date(now.getTime() + 7 * DAY) : null,
    expireBy: phase === "PENDING_AUTHENTICATION" ? new Date(now.getTime() + DAY) : null,
    advisoryPaymentMethod: options.advisoryPaymentMethod ?? null,
    advisoryInternationalCard: options.advisoryInternationalCard ?? null,
    firstContributedAt: ["ACTIVE", "TRIALING", "PAST_DUE"].includes(phase) ? new Date(now.getTime() - 10 * DAY) : null,
    lastAppliedObservationAt: new Date(now.getTime() - DAY),
    ...options.row,
  });

  fake.seed({
    providerSubscriptionId,
    rawStatus: STATUS_FOR[phase] ?? "active",
    providerPlanId: fakePlanId(plan, cycle),
    currentStart: row.currentPeriodStart,
    currentEnd: row.currentPeriodEnd,
    chargeAt: row.currentPeriodEnd,
    startAt: row.startAt,
    expireBy: row.expireBy,
    notes: { kz_sub: row.id, kz_env: "TEST" },
    paidCount: 1,
    ...options.provider,
  });

  return row;
}

export function reloadSubscription(id: string) {
  return prisma.subscription.findUniqueOrThrow({ where: { id } });
}

export function operationsOf(userId: string) {
  return prisma.billingOperation.findMany({ where: { userId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
}

export function historyOf(subscriptionId: string) {
  return prisma.subscriptionHistoryEntry.findMany({ where: { subscriptionId }, orderBy: { recordedAt: "asc" } });
}
