/**
 * Billing — The `billing:sync` Task
 *
 * Due-based reconciliation (SB-RC-05): drain whatever subscriptions are due,
 * oldest first, within the provider request budget and a wall-clock budget,
 * and leave the rest due. It is the backstop that makes correctness independent
 * of any single webhook arriving: a missed event is observed at its
 * subscription's next checkpoint or heartbeat.
 *
 *   disabled                  -> { skipped: "disabled" }
 *   lapsed IN_FLIGHT ops      -> OUTCOME_UNKNOWN, and their subscription marked due (local, cheap)
 *   auth pinned / cooling     -> no provider work this run
 *   drain                     -> until the deadline, an empty claim, or a refusal
 *   unmatched webhook events  -> resolved through notes (IB-24 item 4)
 *   health checks             -> SYNC_OVERDUE, WEBHOOK_SILENCE, sustained BUDGET_EXHAUSTED,
 *                                OPERATION_OUTCOME_UNKNOWN (Phase V)
 *
 * Scheduler-agnostic (SB-PB-06): it takes a budget and knows nothing about
 * HTTP, Vercel or cron. The tick registers it before `notifications:tick`
 * (IB-10), and `GET /api/v1/internal/billing/sync` runs it by hand.
 *
 * Background work only reads from the provider (SB-RC-10).
 */
import { randomUUID } from "node:crypto";

import type { ProviderMode } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { ALERT_CONFIG, SYNC_CONFIG } from "../../config/billing-config";
import { BillingAlertCondition, logBillingAlert, logBillingEvent } from "../../observability/log";
import type { ProviderHealth } from "../../provider/budgeted-provider";
import { getProviderHealth } from "../../provider/provider-factory";
import { getProviderMode, type ResolvedProviderMode } from "../../provider/provider-mode";
import { BillingOperationRepository } from "../commands/operation.repository";
import { SyncClaimRepository } from "../sync/claim.repository";
import { SyncService, type DrainCounts } from "../sync/sync.service";
import { UnmatchedEventResolver } from "../webhooks/unmatched-resolver";

/** Resolves unmatched webhook events (the tick's backstop for `after()`). */
export interface UnmatchedEventDrain {
  resolvePending(options: { mode: ProviderMode; now: Date; deadline: Date }): Promise<Record<string, number>>;
}

export interface BillingSyncTaskDeps {
  readonly sync?: SyncService;
  readonly health?: () => ProviderHealth | null;
  readonly resolvedMode?: () => ResolvedProviderMode;
  readonly now?: () => Date;
  readonly unmatched?: UnmatchedEventDrain;
}

export interface BillingSyncRunOptions {
  /** The soft wall-clock budget. No new fetch starts after it. */
  readonly budgetMs?: number;
}

const OPEN_SYNCED_PHASES = ["PENDING_AUTHENTICATION", "TRIALING", "ACTIVE", "PAST_DUE", "HALTED", "PAUSED"] as const;

export class BillingSyncTask {
  private readonly sync: SyncService;
  private readonly health: () => ProviderHealth | null;
  private readonly resolvedMode: () => ResolvedProviderMode;
  private readonly now: () => Date;
  private readonly unmatched: UnmatchedEventDrain;

  constructor(deps: BillingSyncTaskDeps = {}) {
    this.now = deps.now ?? (() => new Date());
    this.unmatched = deps.unmatched ?? new UnmatchedEventResolver({ now: this.now });
    this.sync = deps.sync ?? new SyncService({ now: this.now });
    this.health = deps.health ?? getProviderHealth;
    this.resolvedMode = deps.resolvedMode ?? getProviderMode;
  }

  async run(options: BillingSyncRunOptions = {}): Promise<Record<string, unknown>> {
    const mode = this.resolvedMode();

    if (mode === "DISABLED") return { skipped: "disabled" };

    const syncRunId = randomUUID();
    const startedAt = this.now();
    const deadline = new Date(startedAt.getTime() + (options.budgetMs ?? SYNC_CONFIG.wallClockMs));
    const operationsExpired = await this.expireLapsedOperations(mode, startedAt);

    const verdict = await this.verdictSafely();
    let drained: DrainCounts | null = null;
    let unmatched: Record<string, number> | null = null;

    if (verdict === "CLEAR") {
      drained = await this.sync.drain({ mode, deadline });

      if (drained.stoppedBy === "EMPTY" && this.now().getTime() < deadline.getTime()) {
        unmatched = await this.unmatched.resolvePending({ mode, now: this.now(), deadline });
      }
    }

    const backlog = await SyncClaimRepository.dueBacklog(mode, this.now());
    const oldestDueAgeSeconds = backlog.oldestDueAt
      ? Math.max(0, Math.round((this.now().getTime() - backlog.oldestDueAt.getTime()) / 1000))
      : null;

    await this.checkHealth(mode, drained, backlog.remainingDue, oldestDueAgeSeconds, syncRunId);

    const summary = {
      mode,
      syncRunId,
      ...(verdict === "CLEAR" ? {} : { skipped: verdict === "AUTH_PINNED" ? "auth_pinned" : "cooldown" }),
      operationsExpired,
      claimed: drained?.claimed ?? 0,
      applied: drained?.applied ?? 0,
      noChange: drained?.noChange ?? 0,
      staleDiscarded: drained?.staleDiscarded ?? 0,
      rejected: drained?.rejected ?? 0,
      failed: drained?.failed ?? {},
      notAttempted: drained?.notAttempted ?? 0,
      stoppedBy: drained?.stoppedBy ?? null,
      ...(unmatched && { unmatched }),
      remainingDue: backlog.remainingDue,
      oldestDueAgeSeconds,
      durationMs: this.now().getTime() - startedAt.getTime(),
    };

    logBillingEvent("sync.run", summary);

    return summary;
  }

  /** Lapsed `IN_FLIGHT` operations become `OUTCOME_UNKNOWN` (shared with the command runner's self-heal). */
  private async expireLapsedOperations(mode: ProviderMode, now: Date): Promise<number> {
    return prisma.$transaction((tx) => BillingOperationRepository.expireLapsed(tx, { mode, now }));
  }

  private async verdictSafely(): Promise<"CLEAR" | "COOLING_DOWN" | "AUTH_PINNED"> {
    const health = this.health();

    if (health === null) return "CLEAR";

    try {
      return await health.verdict();
    } catch {
      // The budgeted provider treats an unreadable verdict the same way; its budget check still guards.
      return "CLEAR";
    }
  }

  private async checkHealth(
    mode: ProviderMode,
    drained: DrainCounts | null,
    remainingDue: number,
    oldestDueAgeSeconds: number | null,
    syncRunId: string,
  ): Promise<void> {
    if (oldestDueAgeSeconds !== null && oldestDueAgeSeconds > ALERT_CONFIG.syncOverdueSeconds) {
      logBillingAlert(BillingAlertCondition.SYNC_OVERDUE, "HIGH", { mode, syncRunId, remainingDue, oldestDueAgeSeconds });
    }

    if (drained?.stoppedBy === "NOT_ATTEMPTED" && drained.applied + drained.noChange === 0 && remainingDue > 0) {
      logBillingAlert(BillingAlertCondition.BUDGET_EXHAUSTED, "HIGH", { mode, syncRunId, remainingDue });
    }

    await this.checkWebhookSilence(mode, syncRunId);
    await this.checkUnresolvedOperations(mode, syncRunId);
  }

  /**
   * `OPERATION_OUTCOME_UNKNOWN`: a command whose outcome is still unknown past
   * the threshold. A user may have been charged without a record, or is
   * blocked from billing; the runbook says how to resolve it.
   */
  private async checkUnresolvedOperations(mode: ProviderMode, syncRunId: string): Promise<void> {
    const olderThan = new Date(this.now().getTime() - ALERT_CONFIG.operationOutcomeUnknownSeconds * 1000);
    const where = { providerMode: mode, status: "OUTCOME_UNKNOWN" as const, createdAt: { lt: olderThan } };
    const count = await prisma.billingOperation.count({ where });

    if (count === 0) return;

    const oldest = await prisma.billingOperation.findFirst({
      where,
      orderBy: { createdAt: "asc" },
      select: { id: true, kind: true, createdAt: true },
    });

    logBillingAlert(BillingAlertCondition.OPERATION_OUTCOME_UNKNOWN, "HIGH", {
      mode,
      syncRunId,
      count,
      oldestOperationId: oldest?.id ?? null,
      oldestKind: oldest?.kind ?? null,
      oldestCreatedAt: oldest?.createdAt ?? null,
    });
  }

  /**
   * `WEBHOOK_SILENCE`: synced subscriptions exist, yet no event has arrived for
   * longer than expected. Razorpay disables a webhook after 24 hours of failed
   * deliveries, so this is how a dead endpoint is noticed.
   */
  private async checkWebhookSilence(mode: ProviderMode, syncRunId: string): Promise<void> {
    const openWhere = {
      providerMode: mode,
      phase: { in: [...OPEN_SYNCED_PHASES] },
      providerSubscriptionId: { not: null },
    };

    const oldestOpen = await prisma.subscription.findFirst({
      where: openWhere,
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });

    if (oldestOpen === null) return;

    const lastEvent = await prisma.billingEvent.findFirst({
      where: { providerMode: mode },
      orderBy: { receivedAt: "desc" },
      select: { receivedAt: true },
    });
    const since = lastEvent?.receivedAt ?? oldestOpen.createdAt;
    const silentSeconds = Math.round((this.now().getTime() - since.getTime()) / 1000);

    if (silentSeconds > ALERT_CONFIG.webhookSilenceSeconds) {
      logBillingAlert(BillingAlertCondition.WEBHOOK_SILENCE, "HIGH", {
        mode,
        syncRunId,
        silentSeconds,
        lastEventAt: lastEvent?.receivedAt ?? null,
      });
    }
  }
}
