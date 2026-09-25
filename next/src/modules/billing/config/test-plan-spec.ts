/**
 * Billing — TEST Verification Plans
 *
 * The four Razorpay **TEST** plans Phase IV's real webhook verification (and
 * Phase V's TEST checkout) uses. `pnpm billing:test-plans` creates them, once,
 * and prints the IDs for the TEST catalog (`plan-catalog.ts`).
 *
 * **The prices are temporary, TEST-only verification values** set by the
 * owner on 2026-09-25. They are NOT Kizunia's pricing and not a product
 * decision: LIVE pricing is still open (B6, a LIVE blocker for Phase IX).
 * TEST mode moves no real money.
 *
 * To change them, edit the amounts AND bump `TEST_PLAN_VERSION`. Razorpay
 * plans are immutable and cannot be deleted, so a new price is a new plan:
 * the bumped version gives new plans new keys and names, the tool creates
 * them, and the old IDs stay in the catalog marked `retired` so any
 * subscription created on them still resolves (SB-PB-05). Editing an amount
 * without bumping the version makes the tool stop and report the difference,
 * never overwrite.
 */
import type { BillingCycle, MembershipPlan } from "@/generated/prisma";

export const TEST_PLAN_VERSION = 1;

export interface TestPlanSpec {
  readonly plan: MembershipPlan;
  readonly cycle: BillingCycle;
  /** Whole rupees. Razorpay stores paise (× 100). */
  readonly amountRupees: number;
}

export const TEST_PLAN_SPECS: readonly TestPlanSpec[] = [
  { plan: "PRO", cycle: "MONTHLY", amountRupees: 10 },
  { plan: "PRO", cycle: "YEARLY", amountRupees: 12 },
  { plan: "PRO_PLUS", cycle: "MONTHLY", amountRupees: 20 },
  { plan: "PRO_PLUS", cycle: "YEARLY", amountRupees: 22 },
];
