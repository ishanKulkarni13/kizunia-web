/**
 * Billing — SyncService
 *
 * The one synchronization mechanism (SB-RC-04). Every trigger — a webhook's
 * `after()`, the `billing:sync` tick, an admin "sync now", and from Phase V a
 * checkout or command confirmation — ends here:
 *
 *   claim (a lease on the row) -> fetch, OUTSIDE any transaction, through the
 *   budgeted provider at the trigger's priority -> apply (apply.ts) | back off
 *
 * A failed fetch is never an observation (SB-RC-07). What it means is decided
 * by `policy/sync-failure.ts`; in particular a `REJECTED` or `NOT_FOUND` fetch
 * of a stored ID raises `PROVIDER_SUBSCRIPTION_MISSING` (IB-23). A call the
 * budget, the cooldown or the auth pin refused sent nothing: the row is left
 * due exactly as it was and the batch stops.
 *
 * Background syncs only ever read from the provider (SB-RC-10). Scheduler- and
 * HTTP-agnostic: callers pass the clock and a deadline.
 */
import type { HistoryTrigger, ProviderFailureClass, ProviderMode } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { ALERT_CONFIG, SYNC_CONFIG } from "../../config/billing-config";
import type { PlanCatalog } from "../../config/plan-catalog";
import { BillingAlertCondition, logBillingAlert, logBillingError, logBillingEvent } from "../../observability/log";
import type { NextDueSettings } from "../../policy/next-due";
import { interpretSyncFetchFailure } from "../../policy/sync-failure";
import { getBillingProvider } from "../../provider/provider-factory";
import { getProviderMode, type ResolvedProviderMode } from "../../provider/provider-mode";
import { ProviderPriority, type BillingProvider } from "../../provider/types";
import { AnomalySubject } from "../anomalies/anomaly.repository";
import { applyObservation, raiseAnomaly, type Effects } from "./apply";
import { SyncClaimRepository, type ClaimedSubscription } from "./claim.repository";
import { recordSyncFailure } from "./sync-failure.repository";

export type SyncOutcome =
  | "APPLIED"
  | "NO_CHANGE"
  | "STALE_DISCARDED"
  /** Fetched, but the observation could not be applied (validation, terminal guard). */
  | "REJECTED"
  /** The fetch failed after reaching the provider; the row backs off. */
  | "FAILED"
  /** Nothing reached the provider (budget, cooldown, auth pin); the row stays due. */
  | "NOT_ATTEMPTED"
  | "PROVIDER_DISABLED"
  /** A targeted sync of a row from another provider mode: never fetched. */
  | "MODE_MISMATCH"
  /** Another worker holds the row's lease. */
  | "LEASED"
  /** No provider subscription to fetch (not yet bound). */
  | "NOT_SYNCABLE"
  | "NOT_FOUND"
  /** An unexpected error; the lease lapses and the row is retried. */
  | "ERROR";

export interface SyncResult {
  readonly outcome: SyncOutcome;
  readonly failureClass?: ProviderFailureClass;
  /** The phase after the sync, when it applied. */
  readonly phase?: string;
  /** The rest of the batch should not be attempted this run. */
  readonly stopBatch: boolean;
}

export interface SyncOptions {
  /** How Kizunia found out, for history. Defaults to the row's sync reason. */
  readonly trigger?: HistoryTrigger;
  readonly actorUserId?: string | null;
}

export interface SyncServiceDeps {
  readonly providerFor?: (priority: ProviderPriority) => BillingProvider;
  readonly resolvedMode?: () => ResolvedProviderMode;
  readonly now?: () => Date;
  readonly random?: () => number;
  readonly catalog?: PlanCatalog;
  readonly schedule?: NextDueSettings;
  readonly leaseSeconds?: number;
}

export interface DrainOptions {
  readonly mode: ProviderMode;
  /** No new fetch starts at or after this instant. */
  readonly deadline: Date;
  readonly batchSize?: number;
}

export type DrainStop = "DEADLINE" | "EMPTY" | "NOT_ATTEMPTED" | "PROVIDER";

export interface DrainCounts {
  claimed: number;
  applied: number;
  noChange: number;
  staleDiscarded: number;
  rejected: number;
  failed: Partial<Record<ProviderFailureClass | "ERROR", number>>;
  notAttempted: number;
  stoppedBy: DrainStop | null;
}

/** Rows marked by an event wait for a customer: they fetch at priority 2 (reconciliation.md). */
export function drainPriorityFor(row: Pick<ClaimedSubscription, "syncReason">): ProviderPriority {
  return row.syncReason === "WEBHOOK" || row.syncReason === "CHECKOUT_CONFIRM"
    ? ProviderPriority.CONFIRMATION
    : ProviderPriority.RECONCILIATION;
}

export class SyncService {
  private readonly providerFor: (priority: ProviderPriority) => BillingProvider;
  private readonly resolvedMode: () => ResolvedProviderMode;
  private readonly now: () => Date;
  private readonly leaseSeconds: number;

  constructor(private readonly deps: SyncServiceDeps = {}) {
    this.providerFor = deps.providerFor ?? getBillingProvider;
    this.resolvedMode = deps.resolvedMode ?? getProviderMode;
    this.now = deps.now ?? (() => new Date());
    this.leaseSeconds = deps.leaseSeconds ?? SYNC_CONFIG.leaseSeconds;
  }

  /**
   * Syncs one subscription now, by id: the webhook `after()` path and admin
   * "sync now". Skipped when another worker holds it, which will apply its
   * own fetch.
   */
  async syncTargeted(subscriptionId: string, priority: ProviderPriority, options: SyncOptions = {}): Promise<SyncResult> {
    const mode = this.resolvedMode();

    if (mode === "DISABLED") return { outcome: "PROVIDER_DISABLED", stopBatch: true };

    const row = await SyncClaimRepository.claimOne(subscriptionId, this.now(), this.leaseSeconds);

    if (row === null) return { outcome: await this.whyNotClaimable(subscriptionId), stopBatch: false };

    if (row.providerMode !== mode) {
      await this.reportModeMismatch(row, mode);

      return { outcome: "MODE_MISMATCH", stopBatch: false };
    }

    return this.syncClaimed(row, priority, options);
  }

  /** Fetches and applies one row this worker has claimed. Always gives the lease back or replaces it. */
  async syncClaimed(row: ClaimedSubscription, priority: ProviderPriority, options: SyncOptions = {}): Promise<SyncResult> {
    const mode = this.resolvedMode();
    const log = { subscriptionId: row.id, mode: row.providerMode, priority, trigger: options.trigger ?? row.syncReason };

    if (mode === "DISABLED") {
      await SyncClaimRepository.releaseLease([row.id], this.now());

      return { outcome: "PROVIDER_DISABLED", stopBatch: true };
    }

    try {
      logBillingEvent("sync.claimed", log);

      const outcome = await this.providerFor(priority).fetchSubscription(row.providerSubscriptionId);

      if (outcome.kind === "PROVIDER_DISABLED") {
        await SyncClaimRepository.releaseLease([row.id], this.now());

        return { outcome: "PROVIDER_DISABLED", stopBatch: true };
      }

      if (outcome.kind === "FAILURE") {
        return await this.onFetchFailure(row, outcome.failureClass, outcome.requestSentAt !== undefined, log);
      }

      const applied = await applyObservation(
        row.id,
        { state: outcome.value, observationAt: outcome.observationAt },
        {
          resolvedMode: mode,
          trigger: options.trigger,
          actorUserId: options.actorUserId,
          now: this.now(),
          catalog: this.deps.catalog,
          schedule: this.deps.schedule,
          random: this.deps.random,
        },
      );

      switch (applied.outcome) {
        case "APPLIED":
          return { outcome: applied.changed ? "APPLIED" : "NO_CHANGE", phase: applied.phase, stopBatch: false };
        case "STALE_DISCARDED":
          // A newer observation already applied and scheduled the row; only the lease is ours to give back.
          await SyncClaimRepository.releaseLease([row.id], this.now());

          return { outcome: "STALE_DISCARDED", stopBatch: false };
        case "REJECTED":
          return { outcome: "REJECTED", failureClass: applied.failureClass ?? undefined, stopBatch: false };
        default:
          return { outcome: "NOT_FOUND", stopBatch: false };
      }
    } catch (error) {
      // The lease lapses on its own and the row is retried; nothing was applied.
      logBillingError("sync.error", { ...log, error });

      return { outcome: "ERROR", stopBatch: false };
    }
  }

  /**
   * The `billing:sync` drain: claim due rows oldest first, sync them one at a
   * time, and stop at the deadline, on an empty claim, or as soon as a call is
   * refused for budget, cooldown or credentials. Rows claimed but not reached
   * are given back, still due.
   */
  async drain(options: DrainOptions): Promise<DrainCounts> {
    const counts: DrainCounts = {
      claimed: 0,
      applied: 0,
      noChange: 0,
      staleDiscarded: 0,
      rejected: 0,
      failed: {},
      notAttempted: 0,
      stoppedBy: null,
    };
    const batchSize = options.batchSize ?? SYNC_CONFIG.batchSize;

    while (counts.stoppedBy === null) {
      if (this.now().getTime() >= options.deadline.getTime()) {
        counts.stoppedBy = "DEADLINE";
        break;
      }

      const batch = await SyncClaimRepository.claimDue(options.mode, this.now(), batchSize, this.leaseSeconds);

      // Stop on an empty claim, never on a short one: a short batch may just mean a competing worker.
      if (batch.length === 0) {
        counts.stoppedBy = "EMPTY";
        break;
      }

      counts.claimed += batch.length;

      for (const [index, row] of batch.entries()) {
        if (this.now().getTime() >= options.deadline.getTime()) {
          counts.stoppedBy = "DEADLINE";
        } else {
          const result = await this.syncClaimed(row, drainPriorityFor(row));

          tally(counts, result);

          if (result.stopBatch) counts.stoppedBy = result.outcome === "NOT_ATTEMPTED" ? "NOT_ATTEMPTED" : "PROVIDER";
        }

        if (counts.stoppedBy !== null) {
          const unreached = batch.slice(counts.stoppedBy === "DEADLINE" ? index : index + 1);

          await SyncClaimRepository.releaseLease(unreached.map((r) => r.id), this.now());
          counts.claimed -= unreached.length;
          break;
        }
      }
    }

    return counts;
  }

  // -- Internals ------------------------------------------------------------

  private async onFetchFailure(
    row: ClaimedSubscription,
    failureClass: ProviderFailureClass,
    requestSent: boolean,
    log: Record<string, unknown>,
  ): Promise<SyncResult> {
    const handling = interpretSyncFetchFailure(failureClass, requestSent);
    const now = this.now();

    if (handling.outcome === "NOT_ATTEMPTED") {
      await SyncClaimRepository.releaseLease([row.id], now);
      logBillingEvent("sync.not_attempted", { ...log, failureClass });

      return { outcome: "NOT_ATTEMPTED", failureClass, stopBatch: true };
    }

    const effects: Effects = { alerts: [], events: [] };

    const failure = await prisma.$transaction(async (tx) => {
      const recorded = await recordSyncFailure(tx, row, failureClass, now, this.deps.random);

      if (handling.outcome === "PROVIDER_MISSING") {
        await raiseAnomaly(
          tx,
          {
            type: "PROVIDER_SUBSCRIPTION_MISSING",
            providerMode: row.providerMode,
            subjectKey: AnomalySubject.providerSubscription(row.providerSubscriptionId),
            subscriptionIds: [row.id],
            providerSubscriptionId: row.providerSubscriptionId,
            userId: (await tx.subscription.findUnique({ where: { id: row.id }, select: { userId: true } }))?.userId ?? null,
            details: { failureClass, rule: "IB-23: a sync fetch of a stored ID was refused" },
          },
          now,
          effects,
          log,
        );
      }

      return recorded;
    });

    logBillingEvent("sync.failed", {
      ...log,
      failureClass,
      providerMissing: handling.outcome === "PROVIDER_MISSING",
      attempts: failure.attempts,
      nextDueAt: failure.nextDueAt,
    });
    for (const { event, fields } of effects.events) logBillingEvent(event, fields);
    for (const { condition, severity, fields } of effects.alerts) logBillingAlert(condition, severity, fields);

    if (failureClass === "RATE_LIMITED") {
      logBillingAlert(BillingAlertCondition.RATE_LIMITED, "HIGH", log);
    }

    if (failure.attempts % ALERT_CONFIG.syncOverdueAttempts === 0) {
      logBillingAlert(BillingAlertCondition.SYNC_OVERDUE, "HIGH", { ...log, attempts: failure.attempts, failureClass });
    }

    return { outcome: "FAILED", failureClass, stopBatch: handling.stopBatch };
  }

  private async reportModeMismatch(row: ClaimedSubscription, mode: ProviderMode): Promise<void> {
    const effects: Effects = { alerts: [], events: [] };
    const log = { subscriptionId: row.id, rowMode: row.providerMode, resolvedMode: mode };

    await prisma.$transaction(async (tx) => {
      await tx.subscription.update({ where: { id: row.id }, data: { syncLeaseUntil: null } });
      await raiseAnomaly(
        tx,
        {
          type: "PROVIDER_MODE_MISMATCH",
          providerMode: row.providerMode,
          subjectKey: AnomalySubject.subscription(row.id),
          subscriptionIds: [row.id],
          providerSubscriptionId: row.providerSubscriptionId,
          details: { rowMode: row.providerMode, resolvedMode: mode },
        },
        this.now(),
        effects,
        log,
      );
    });

    for (const { event, fields } of effects.events) logBillingEvent(event, fields);
    for (const { condition, severity, fields } of effects.alerts) logBillingAlert(condition, severity, fields);
  }

  private async whyNotClaimable(subscriptionId: string): Promise<SyncOutcome> {
    const row = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: { providerSubscriptionId: true },
    });

    if (!row) return "NOT_FOUND";

    return row.providerSubscriptionId === null ? "NOT_SYNCABLE" : "LEASED";
  }
}

function tally(counts: DrainCounts, result: SyncResult): void {
  switch (result.outcome) {
    case "APPLIED":
      counts.applied += 1;
      break;
    case "NO_CHANGE":
      counts.noChange += 1;
      break;
    case "STALE_DISCARDED":
      counts.staleDiscarded += 1;
      break;
    case "REJECTED":
      counts.rejected += 1;
      break;
    case "NOT_ATTEMPTED":
    case "PROVIDER_DISABLED":
      counts.notAttempted += 1;
      break;
    default: {
      const key = result.failureClass ?? "ERROR";
      counts.failed[key] = (counts.failed[key] ?? 0) + 1;
    }
  }
}
