/**
 * Billing — Events for Subscriptions Kizunia Does Not Know
 *
 * A verified event whose provider subscription matches no local row is kept,
 * never dropped, as `UNMATCHED_PENDING` (SB-WH-06). This resolves it, from the
 * webhook's `after()` and, as a backstop, from the `billing:sync` tick:
 *
 *   fetch the provider subscription (priority 2 in after(), 3 from the tick), read its notes
 *     a local row is already bound to it       -> link the events, mark it due
 *     kz_env names another mode                -> UNMATCHED + PROVIDER_MODE_MISMATCH
 *     kz_sub names a PROVISIONING row of this mode with no provider ID
 *                                              -> BIND: provider ID, BINDING history, the
 *                                                 create operation settled, events linked,
 *                                                 money facts back-filled; then the fetched
 *                                                 state is applied through the one apply path
 *     kz_sub names anything else               -> UNMATCHED + NOTES_CONFLICT
 *     no Kizunia notes                         -> UNMATCHED + UNMATCHED_PROVIDER_SUBSCRIPTION
 *     the fetch failed transiently             -> left pending for the next attempt
 *     the provider does not know it            -> UNMATCHED + UNMATCHED_PROVIDER_SUBSCRIPTION
 *
 * This is how a create whose response was lost is recovered (SB-CM-03). A
 * provider subscription is attached to a user **only** through Kizunia's own
 * notes, never by email, phone or amount. Nothing is cancelled or adopted at
 * the provider (SB-RC-10); an unmatched subscription is for a human.
 *
 * Until Phase V creates subscriptions, every real unmatched event is a
 * Dashboard-created subscription, so this mostly raises the anomaly; the
 * binding path is exercised by tests and the TEST verification script.
 */
import { Prisma, type BillingAnomalyType, type ProviderMode } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { SYNC_CONFIG } from "../../config/billing-config";
import type { PlanCatalog } from "../../config/plan-catalog";
import { logBillingAlert, logBillingEvent } from "../../observability/log";
import type { NextDueSettings } from "../../policy/next-due";
import { getBillingProvider } from "../../provider/provider-factory";
import { getProviderMode, type ResolvedProviderMode } from "../../provider/provider-mode";
import { ProviderPriority, type BillingProvider } from "../../provider/types";
import { AnomalySubject } from "../anomalies/anomaly.repository";
import { applyObservation, raiseAnomaly, type Effects } from "../sync/apply";
import { bindProvisioning } from "../sync/binding";
import { SyncClaimRepository } from "../sync/claim.repository";

export type UnmatchedOutcome =
  | "BOUND"
  | "LINKED"
  | "UNMATCHED"
  | "RETRY"
  | "NOTHING_PENDING"
  | "DISABLED";

export interface UnmatchedResolverDeps {
  readonly providerFor?: (priority: ProviderPriority) => BillingProvider;
  readonly resolvedMode?: () => ResolvedProviderMode;
  readonly now?: () => Date;
  readonly catalog?: PlanCatalog;
  readonly schedule?: NextDueSettings;
}

export class UnmatchedEventResolver {
  private readonly providerFor: (priority: ProviderPriority) => BillingProvider;
  private readonly resolvedMode: () => ResolvedProviderMode;
  private readonly now: () => Date;

  constructor(private readonly deps: UnmatchedResolverDeps = {}) {
    this.providerFor = deps.providerFor ?? getBillingProvider;
    this.resolvedMode = deps.resolvedMode ?? getProviderMode;
    this.now = deps.now ?? (() => new Date());
  }

  /** Resolves every pending event for one provider subscription. */
  async resolve(providerSubscriptionId: string, priority: ProviderPriority): Promise<UnmatchedOutcome> {
    const mode = this.resolvedMode();

    if (mode === "DISABLED") return "DISABLED";

    const pending = await prisma.billingEvent.count({
      where: { providerMode: mode, providerSubscriptionId, status: "UNMATCHED_PENDING" },
    });

    if (pending === 0) return "NOTHING_PENDING";

    // Bound meanwhile (a create response, another resolver): just link.
    const alreadyBound = await this.findBound(mode, providerSubscriptionId);

    if (alreadyBound) return this.link(mode, providerSubscriptionId, alreadyBound.id);

    const log = { mode, providerSubscriptionId, priority };
    const outcome = await this.providerFor(priority).fetchSubscription(providerSubscriptionId);

    if (outcome.kind === "PROVIDER_DISABLED") return "DISABLED";

    if (outcome.kind === "FAILURE") {
      if (outcome.failureClass === "REJECTED" || outcome.failureClass === "NOT_FOUND") {
        return this.markUnmatched(mode, providerSubscriptionId, "UNMATCHED_PROVIDER_SUBSCRIPTION", {
          reason: "the provider does not recognize this subscription",
          failureClass: outcome.failureClass,
        });
      }

      logBillingEvent("webhook.unmatched_retry", { ...log, failureClass: outcome.failureClass });

      return "RETRY";
    }

    const { value: state, observationAt } = outcome;
    const notedMode = state.notes.kz_env?.trim().toUpperCase() || null;
    const notedSubscription = state.notes.kz_sub?.trim() || null;

    if (notedMode !== null && notedMode !== mode) {
      return this.markUnmatched(mode, providerSubscriptionId, "PROVIDER_MODE_MISMATCH", { notedMode, resolvedMode: mode });
    }

    if (notedSubscription === null) {
      return this.markUnmatched(mode, providerSubscriptionId, "UNMATCHED_PROVIDER_SUBSCRIPTION", {
        reason: "no Kizunia notes",
        rawStatus: state.rawStatus,
        providerPlanId: state.providerPlanId,
      });
    }

    const bound = await this.bind(mode, providerSubscriptionId, notedSubscription, state.notes.kz_op?.trim() || null);

    if (bound === null) {
      return this.markUnmatched(mode, providerSubscriptionId, "NOTES_CONFLICT", {
        notedSubscriptionId: notedSubscription,
        reason: "kz_sub does not name an unbound PROVISIONING subscription of this mode",
      });
    }

    await applyObservation(bound, { state, observationAt }, this.applyContext(mode));

    return "BOUND";
  }

  /**
   * The tick's backstop (IB-24 item 4): pending events older than the grace,
   * oldest first, one resolution per provider subscription, until the deadline.
   */
  async resolvePending(options: { mode: ProviderMode; now: Date; deadline: Date }): Promise<Record<string, number>> {
    const olderThan = new Date(options.now.getTime() - SYNC_CONFIG.unmatchedGraceSeconds * 1000);
    const groups = await prisma.billingEvent.groupBy({
      by: ["providerSubscriptionId"],
      where: {
        providerMode: options.mode,
        status: "UNMATCHED_PENDING",
        receivedAt: { lte: olderThan },
        providerSubscriptionId: { not: null },
      },
      _min: { receivedAt: true },
      orderBy: { _min: { receivedAt: "asc" } },
      take: SYNC_CONFIG.unmatchedBatchSize,
    });

    const counts: Record<string, number> = { pending: groups.length };

    for (const group of groups) {
      if (this.now().getTime() >= options.deadline.getTime()) break;

      const outcome = await this.resolve(group.providerSubscriptionId!, ProviderPriority.RECONCILIATION);

      counts[outcome] = (counts[outcome] ?? 0) + 1;

      if (outcome === "RETRY" || outcome === "DISABLED") break;
    }

    return counts;
  }

  // -- Internals ------------------------------------------------------------

  private findBound(mode: ProviderMode, providerSubscriptionId: string) {
    return prisma.subscription.findUnique({
      where: { providerMode_providerSubscriptionId: { providerMode: mode, providerSubscriptionId } },
      select: { id: true },
    });
  }

  private async link(mode: ProviderMode, providerSubscriptionId: string, subscriptionId: string): Promise<UnmatchedOutcome> {
    const now = this.now();

    await prisma.$transaction(async (tx) => {
      await linkEvents(tx, mode, providerSubscriptionId, subscriptionId);
      await SyncClaimRepository.markDue(tx, subscriptionId, "WEBHOOK", now, { eventDriven: true, now });
    });
    logBillingEvent("webhook.unmatched_linked", { mode, providerSubscriptionId, subscriptionId });

    return "LINKED";
  }

  /**
   * Binds the provider ID to the PROVISIONING row the notes name
   * (`bindProvisioning`), then links the events and back-fills money facts in
   * the same transaction. `null` when that row does not qualify (missing, other
   * mode, bound to another ID, not PROVISIONING), or another row holds the
   * provider ID already.
   */
  private async bind(
    mode: ProviderMode,
    providerSubscriptionId: string,
    subscriptionId: string,
    operationId: string | null,
  ): Promise<string | null> {
    const now = this.now();

    try {
      const bound = await prisma.$transaction(async (tx) => {
        const result = await bindProvisioning(tx, {
          mode,
          providerSubscriptionId,
          subscriptionId,
          operationId,
          trigger: "WEBHOOK",
          now,
        });

        if (result.outcome === "REFUSED") return null;

        await linkEvents(tx, mode, providerSubscriptionId, result.subscriptionId);
        await tx.billingMoneyFact.updateMany({
          where: { providerMode: mode, subscriptionId: null, billingEvent: { providerSubscriptionId } },
          data: { subscriptionId: result.subscriptionId, userId: result.userId },
        });

        return {
          id: result.subscriptionId,
          userId: result.userId,
          operationId: result.outcome === "BOUND" ? result.operationId : null,
        };
      });

      if (bound) {
        logBillingEvent("webhook.unmatched_bound", {
          mode,
          providerSubscriptionId,
          subscriptionId: bound.id,
          userId: bound.userId,
          operationId: bound.operationId,
        });
      }

      return bound?.id ?? null;
    } catch (error) {
      // Another row already holds this provider ID: SB-UQ-01 is a database fact.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;

      throw error;
    }
  }

  private async markUnmatched(
    mode: ProviderMode,
    providerSubscriptionId: string,
    type: BillingAnomalyType,
    details: Record<string, string>,
  ): Promise<UnmatchedOutcome> {
    const effects: Effects = { alerts: [], events: [] };
    const log = { mode, providerSubscriptionId };

    await prisma.$transaction(async (tx) => {
      await tx.billingEvent.updateMany({
        where: { providerMode: mode, providerSubscriptionId, status: "UNMATCHED_PENDING" },
        data: { status: "UNMATCHED" },
      });
      await raiseAnomaly(
        tx,
        {
          type,
          providerMode: mode,
          subjectKey: AnomalySubject.providerSubscription(providerSubscriptionId),
          providerSubscriptionId,
          details,
        },
        this.now(),
        effects,
        log,
      );
    });

    logBillingEvent("webhook.unmatched_final", { ...log, anomaly: type });
    for (const { event, fields } of effects.events) logBillingEvent(event, fields);
    for (const { condition, severity, fields } of effects.alerts) logBillingAlert(condition, severity, fields);

    return "UNMATCHED";
  }

  private applyContext(mode: ProviderMode) {
    return {
      resolvedMode: mode,
      trigger: "WEBHOOK" as const,
      now: this.now(),
      catalog: this.deps.catalog,
      schedule: this.deps.schedule,
    };
  }
}

async function linkEvents(
  tx: Prisma.TransactionClient,
  mode: ProviderMode,
  providerSubscriptionId: string,
  subscriptionId: string,
): Promise<void> {
  await tx.billingEvent.updateMany({
    where: { providerMode: mode, providerSubscriptionId, status: { in: ["UNMATCHED_PENDING", "UNMATCHED"] } },
    data: { status: "RECORDED", subscriptionId },
  });
}

