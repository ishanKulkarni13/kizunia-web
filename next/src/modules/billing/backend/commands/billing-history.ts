/**
 * Billing — The User's Subscription History (for eligibility)
 *
 * What the trial and code rules decide from: the user's own **Subscription**
 * records in one provider mode, read in the transaction that holds their
 * command slot, so a concurrent checkout cannot slip between the check and the
 * write (SB-LC-11, SB-CP-04).
 *
 * One query. A subscription counts once it reached a contributing phase
 * (`firstContributedAt`, set by the apply path on first entry to `TRIALING`,
 * `ACTIVE` or `PAST_DUE`). An abandoned or expired checkout never got there,
 * so it consumes neither a trial nor a code.
 *
 * It reads `Subscription` rows only. Admin grants, promotion grants and the
 * effective-access resolver are deliberately not consulted: a user whose paid
 * access came from a grant has not had a paid *subscription*, so
 * `FIRST_PAID_SUBSCRIPTION_ONLY` still holds for them (IB-27 item 9).
 */
import type { Prisma, PrismaClient, ProviderMode } from "@/generated/prisma";

import type { BillingHistory } from "../../policy/code-eligibility";

export async function loadBillingHistory(
  db: Prisma.TransactionClient | PrismaClient,
  userId: string,
  mode: ProviderMode,
): Promise<BillingHistory> {
  const reached = await db.subscription.findMany({
    where: { userId, providerMode: mode, firstContributedAt: { not: null } },
    select: { kind: true, marketingCode: true },
  });

  return {
    trialConsumed: reached.some((row) => row.kind === "TRIAL"),
    hadQualifyingSubscription: reached.length > 0,
    contributedCodes: new Set(reached.flatMap((row) => (row.marketingCode === null ? [] : [row.marketingCode]))),
  };
}
