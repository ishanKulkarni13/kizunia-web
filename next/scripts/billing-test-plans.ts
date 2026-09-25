/**
 * Creates (or finds) the Razorpay TEST verification plans and prints their IDs
 * as TEST plan-catalog entries. Idempotent: rerunning creates nothing new.
 *
 * TEST only. Reads RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET from next/.env and
 * never prints them. The plans and their temporary TEST-only prices are in
 * src/modules/billing/config/test-plan-spec.ts.
 *
 * Usage:
 *   pnpm billing:test-plans --dry-run   # list what exists and what would be created
 *   pnpm billing:test-plans             # create what is missing
 *
 * Exit code 1 when an existing plan differs from the spec (nothing is
 * overwritten: bump TEST_PLAN_VERSION to create new plans instead).
 */
import "dotenv/config";

import { resolveProviderConfiguration } from "@/modules/billing/provider/provider-mode";
import { catalogSnippet, ensureTestPlans } from "@/modules/billing/provider/test-plan-setup";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const result = await ensureTestPlans({ dryRun, configuration: resolveProviderConfiguration() });

  for (const entry of result.entries) {
    console.log(
      `${entry.action.padEnd(12)} ${entry.key.padEnd(26)} ${entry.name.padEnd(32)} ₹${entry.amountMinor / 100}` +
        `${entry.providerPlanId ? `  ${entry.providerPlanId}` : ""}`,
    );
    for (const difference of entry.differences ?? []) console.log(`             ${difference}`);
  }

  console.log(`\n${catalogSnippet(result)}`);

  if (!result.ok) {
    console.error("\nAn existing plan differs from the spec. Nothing was overwritten; bump TEST_PLAN_VERSION to create new plans.");
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "billing:test-plans failed");
  process.exit(1);
});
