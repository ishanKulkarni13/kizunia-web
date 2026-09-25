/**
 * Billing — The Local `PROVISIONING` Record
 *
 * `PROVISIONING` and `ABANDONED` are the only phases Kizunia writes without an
 * observation (state-model.md): the record of an intent to create, written in
 * its own committed transaction before the provider is called (SB-CM-02), and
 * its closure when the create provably never happened.
 */
import type {
  BillingCycle,
  HistoryTrigger,
  MembershipPlan,
  Prisma,
  PrismaClient,
  ProviderMode,
  Subscription,
} from "@/generated/prisma";

import { isOpenPhase } from "../../policy/state-mapping";
import type { OpenSubscriptionView } from "../../policy/command-preconditions";
import { SubscriptionHistoryRepository } from "../history/history.repository";
import { BillingOperationRepository } from "./operation.repository";

type Tx = Prisma.TransactionClient;

/** The user's subscriptions in an open phase, in `mode`, oldest first. */
export async function loadOpenSubscriptions(tx: Tx | PrismaClient, userId: string, mode: ProviderMode): Promise<Subscription[]> {
  const rows = await tx.subscription.findMany({
    where: { userId, providerMode: mode, phase: { notIn: ["CANCELLED", "EXPIRED", "COMPLETED", "ABANDONED"] } },
    orderBy: { createdAt: "asc" },
  });

  return rows.filter((row) => isOpenPhase(row.phase));
}

export function openView(row: Subscription): OpenSubscriptionView {
  return {
    id: row.id,
    phase: row.phase,
    plan: row.plan,
    cycle: row.cycle,
    expireBy: row.expireBy,
    advisoryPaymentMethod: row.advisoryPaymentMethod,
    advisoryInternationalCard: row.advisoryInternationalCard,
  };
}

/** Writes the `PROVISIONING` record a create will carry in `notes.kz_sub`, and links it to its operation. */
export async function createProvisioning(
  tx: Tx,
  input: {
    readonly userId: string;
    readonly mode: ProviderMode;
    readonly plan: MembershipPlan;
    readonly cycle: BillingCycle;
    readonly operationId: string;
    readonly now: Date;
  },
): Promise<Subscription> {
  const subscription = await tx.subscription.create({
    data: {
      userId: input.userId,
      kind: "STANDARD",
      providerMode: input.mode,
      plan: input.plan,
      cycle: input.cycle,
      phase: "PROVISIONING",
      createdAt: input.now,
    },
  });

  await BillingOperationRepository.linkSubscription(tx, input.operationId, subscription.id);

  return subscription;
}

/**
 * Closes an unbound `PROVISIONING` record: the create was refused, never sent,
 * or its orphan window closed without a match. Only an unbound record moves;
 * one a webhook or scan bound meanwhile is left for the apply path.
 */
export async function abandonProvisioning(
  tx: Tx,
  input: {
    readonly subscriptionId: string;
    readonly operationId: string | null;
    readonly trigger: HistoryTrigger;
    readonly now: Date;
  },
): Promise<boolean> {
  const { count } = await tx.subscription.updateMany({
    where: { id: input.subscriptionId, phase: "PROVISIONING", providerSubscriptionId: null },
    data: { phase: "ABANDONED", syncDueAt: null, syncLeaseUntil: null, updatedAt: input.now },
  });

  if (count === 0) return false;

  const row = await tx.subscription.findUniqueOrThrow({ where: { id: input.subscriptionId }, select: { userId: true } });

  await SubscriptionHistoryRepository.record(tx, [
    {
      subscriptionId: input.subscriptionId,
      userId: row.userId,
      change: "PHASE",
      fromValue: "PROVISIONING",
      toValue: "ABANDONED",
      cause: input.operationId ? "KIZUNIA_COMMAND" : "LOCAL",
      trigger: input.trigger,
      operationId: input.operationId,
    },
  ]);

  return true;
}
