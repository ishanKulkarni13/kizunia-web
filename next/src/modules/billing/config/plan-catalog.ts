/**
 * Billing — Provider Plan Catalog
 *
 * Maps Razorpay plan IDs to a Kizunia plan and billing cycle, per provider
 * mode (SB-PB-05). It is the only place a Razorpay plan ID appears in code:
 * everywhere else works with `MembershipPlan` and `BillingCycle`.
 *
 * Two rules shape it:
 *
 *  - **Many provider plans map to one Kizunia plan and cycle.** A price
 *    change, a plan re-created in the Dashboard, or a regional variant is a new
 *    Razorpay plan; the Kizunia plan is unchanged. So several IDs may map to
 *    the same (plan, cycle).
 *  - **Retired IDs are kept.** A subscriber created on an old plan keeps
 *    paying on it, so an observed subscription must still resolve. A retired
 *    entry is never chosen for a *new* purchase, and it is never deleted from
 *    here while any subscription may still reference it.
 *
 * Test and live plans are different objects in different accounts, so each
 * mode has its own list. The catalog is TypeScript configuration, code-reviewed
 * and deployed: plan IDs are not secret, and a wrong one should be a diff, not
 * a runtime setting.
 *
 * TEST holds the four verification plans Phase IV created with
 * `pnpm billing:test-plans` (spec and prices in `test-plan-spec.ts`). Their
 * prices are **temporary TEST-only values**, not Kizunia pricing. LIVE ships
 * EMPTY until pricing is decided (B6, a LIVE blocker, resolved in Phase IX).
 * An empty catalog is a safe state: creating a subscription for an unmapped
 * (plan, cycle) is refused as `UNMAPPED_PLAN` before anything is sent, and an
 * unknown plan on an observed subscription is reported, never guessed at.
 *
 * Adding an entry is the whole procedure; the invariants below are checked
 * when this module loads, so a bad entry fails the first test run.
 */
import type { BillingCycle, MembershipPlan, ProviderMode } from "@/generated/prisma";

export interface PlanCatalogEntry {
  /** The Razorpay plan ID, e.g. `plan_Abc123`. */
  readonly providerPlanId: string;
  readonly plan: MembershipPlan;
  readonly cycle: BillingCycle;
  /**
   * No longer offered for a new purchase, but existing subscriptions on it
   * still resolve. Keep the entry for as long as one may exist.
   */
  readonly retired?: boolean;
}

export interface PlanCatalog {
  /** Resolves any known provider plan ID, retired or not. */
  findByProviderPlanId(providerPlanId: string): PlanCatalogEntry | undefined;

  /**
   * The Razorpay plan ID to use for a NEW subscription of this plan and cycle,
   * or `undefined` when none is configured. Never returns a retired ID.
   */
  currentProviderPlanId(plan: MembershipPlan, cycle: BillingCycle): string | undefined;
}

/**
 * Builds a catalog from entries, refusing an inconsistent list:
 *  - a provider plan ID appears once (it maps to one plan and cycle);
 *  - at most one entry per (plan, cycle) is current (not retired), so "the plan
 *    to sell" is never ambiguous.
 */
export function createPlanCatalog(entries: readonly PlanCatalogEntry[]): PlanCatalog {
  const byProviderPlanId = new Map<string, PlanCatalogEntry>();
  const currentByPlanAndCycle = new Map<string, string>();

  for (const entry of entries) {
    if (entry.providerPlanId.trim() === "") {
      throw new Error("Plan catalog: an entry has an empty provider plan ID.");
    }

    if (byProviderPlanId.has(entry.providerPlanId)) {
      throw new Error(
        `Plan catalog: provider plan ID ${entry.providerPlanId} is listed more than once.`,
      );
    }

    byProviderPlanId.set(entry.providerPlanId, entry);

    if (entry.retired) continue;

    const slot = `${entry.plan}:${entry.cycle}`;
    const existing = currentByPlanAndCycle.get(slot);

    if (existing !== undefined) {
      throw new Error(
        `Plan catalog: ${entry.plan} ${entry.cycle} has two current plans ` +
          `(${existing} and ${entry.providerPlanId}). Retire one.`,
      );
    }

    currentByPlanAndCycle.set(slot, entry.providerPlanId);
  }

  return {
    findByProviderPlanId: (providerPlanId) => byProviderPlanId.get(providerPlanId),
    currentProviderPlanId: (plan, cycle) => currentByPlanAndCycle.get(`${plan}:${cycle}`),
  };
}

/**
 * Razorpay TEST verification plans, v1 (`TEST_PLAN_VERSION`), created
 * 2026-09-25. Temporary TEST-only prices set by the owner; not Kizunia
 * pricing. When the spec's version is bumped, add the new IDs and mark these
 * `retired: true` (never delete them while a TEST subscription may use them).
 */
const TEST_PLANS: readonly PlanCatalogEntry[] = [
  // KZ-TEST v1 PRO monthly: INR 10
  { providerPlanId: "plan_TgDgeZ5thTGEr8", plan: "PRO", cycle: "MONTHLY" },
  // KZ-TEST v1 PRO yearly: INR 12
  { providerPlanId: "plan_TgDgejlJXhdilW", plan: "PRO", cycle: "YEARLY" },
  // KZ-TEST v1 PRO_PLUS monthly: INR 20
  { providerPlanId: "plan_TgDgfArS3b5MQu", plan: "PRO_PLUS", cycle: "MONTHLY" },
  // KZ-TEST v1 PRO_PLUS yearly: INR 22
  { providerPlanId: "plan_TgDgfLV0VuYLQz", plan: "PRO_PLUS", cycle: "YEARLY" },
];

const LIVE_PLANS: readonly PlanCatalogEntry[] = [];

const CATALOGS: Readonly<Record<ProviderMode, PlanCatalog>> = {
  TEST: createPlanCatalog(TEST_PLANS),
  LIVE: createPlanCatalog(LIVE_PLANS),
};

/** The catalog for a provider mode. A mode never sees the other's plans. */
export function getPlanCatalog(mode: ProviderMode): PlanCatalog {
  return CATALOGS[mode];
}
