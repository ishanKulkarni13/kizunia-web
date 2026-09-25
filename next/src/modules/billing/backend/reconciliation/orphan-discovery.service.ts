/**
 * Billing — Orphan Discovery (`billing:orphan-discovery`)
 *
 * Finds provider subscriptions Kizunia has no record pointing at
 * (docs/architecture/subscription/reconciliation/orphan-discovery.md). It is
 * how a create whose response was lost is found again when no webhook
 * arrives (an abandoned checkout produces none), and how a create that never
 * happened is finally closed:
 *
 *   window.from := watermark - overlap        (the list filter is created_at, both bounds inclusive: A5)
 *   window.to   := now - settleDelay          (an in-progress create is not misreported)
 *   page through list(from, to, count, skip)  at most maxPagesPerRun pages, priority 4, until the deadline;
 *                                             the cursor (windowTo, skip) is saved after every page
 *     known provider ID                       -> skip
 *     notes name another mode                 -> PROVIDER_MODE_MISMATCH
 *     kz_sub names an unbound PROVISIONING    -> bind (the create settles SUCCEEDED), apply the listed state
 *     kz_sub names anything else              -> NOTES_CONFLICT
 *     no Kizunia notes                        -> UNMATCHED_PROVIDER_SUBSCRIPTION (one open anomaly per ID)
 *   a short page ends the window              -> watermark := window.to, and only then:
 *     close every unbound PROVISIONING of this mode whose create is OUTCOME_UNKNOWN and whose send-time
 *     bound + overlap <= watermark            -> ABANDONED, operation NOT_APPLIED
 *
 * The send-time bound is `COALESCE(requestSentAt, leaseUntil)`: after a crash
 * `requestSentAt` was never persisted, and the lease end is a safe upper bound
 * (IB-25 item 2). The window is generous on purpose: closing a create too
 * early is how a later duplicate could be created.
 *
 * It only reads from the provider (SB-RC-10): it never cancels an unmatched
 * subscription and never attaches one to a user by anything but Kizunia's own
 * notes. An operator decides (operations-runbook.md).
 */
import { Prisma, type BillingAnomalyType, type ProviderMode } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { ORPHAN_CONFIG } from "../../config/billing-config";
import type { PlanCatalog } from "../../config/plan-catalog";
import { logBillingEvent } from "../../observability/log";
import type { NextDueSettings } from "../../policy/next-due";
import { getBillingProvider } from "../../provider/provider-factory";
import { getProviderMode, type ResolvedProviderMode } from "../../provider/provider-mode";
import { ProviderPriority, type BillingProvider, type ProviderSubscriptionState } from "../../provider/types";
import { AnomalySubject } from "../anomalies/anomaly.repository";
import { BillingOperationRepository } from "../commands/operation.repository";
import { abandonProvisioning } from "../commands/provisioning";
import { applyObservation, emitEffects, newEffects, raiseAnomaly } from "../sync/apply";
import { bindProvisioning } from "../sync/binding";

export interface OrphanDiscoverySettings {
  readonly overlapSeconds: number;
  readonly settleDelaySeconds: number;
  readonly pageSize: number;
  readonly maxPagesPerRun: number;
}

export interface OrphanDiscoveryDeps {
  readonly providerFor?: (priority: ProviderPriority) => BillingProvider;
  readonly resolvedMode?: () => ResolvedProviderMode;
  readonly now?: () => Date;
  readonly catalog?: PlanCatalog;
  readonly schedule?: NextDueSettings;
  readonly settings?: Partial<OrphanDiscoverySettings>;
}

export type OrphanStop =
  /** The window was paged to its end. */
  | "WINDOW_COMPLETE"
  /** Nothing to scan yet (the window would be empty). */
  | "EMPTY_WINDOW"
  | "MAX_PAGES"
  | "DEADLINE"
  /** The budget or the cooldown refused the call: nothing was sent. */
  | "NOT_ATTEMPTED"
  /** The list request failed after it was sent. */
  | "FAILED"
  /** Another run moved the cursor meanwhile. */
  | "CURSOR_MOVED";

export interface OrphanRunResult {
  readonly mode: ProviderMode;
  readonly windowFrom: Date | null;
  readonly windowTo: Date | null;
  readonly watermark: Date | null;
  readonly pages: number;
  readonly items: number;
  readonly known: number;
  readonly bound: number;
  readonly unmatched: number;
  readonly conflicts: number;
  readonly closed: number;
  readonly operationsExpired: number;
  readonly stoppedBy: OrphanStop;
}

interface Cursor {
  readonly watermark: Date;
  readonly windowTo: Date;
  readonly skip: number;
}

type ItemOutcome = "KNOWN" | "BOUND" | "UNMATCHED" | "CONFLICT";

export class OrphanDiscoveryService {
  private readonly providerFor: (priority: ProviderPriority) => BillingProvider;
  private readonly resolvedMode: () => ResolvedProviderMode;
  private readonly now: () => Date;
  private readonly settings: OrphanDiscoverySettings;

  constructor(private readonly deps: OrphanDiscoveryDeps = {}) {
    this.providerFor = deps.providerFor ?? getBillingProvider;
    this.resolvedMode = deps.resolvedMode ?? getProviderMode;
    this.now = deps.now ?? (() => new Date());
    this.settings = {
      overlapSeconds: deps.settings?.overlapSeconds ?? ORPHAN_CONFIG.overlapSeconds,
      settleDelaySeconds: deps.settings?.settleDelaySeconds ?? ORPHAN_CONFIG.settleDelaySeconds,
      pageSize: deps.settings?.pageSize ?? ORPHAN_CONFIG.pageSize,
      maxPagesPerRun: deps.settings?.maxPagesPerRun ?? ORPHAN_CONFIG.maxPagesPerRun,
    };
  }

  async run(options: { readonly deadline: Date }): Promise<OrphanRunResult | { readonly skipped: "disabled" }> {
    const mode = this.resolvedMode();

    if (mode === "DISABLED") return { skipped: "disabled" };

    const startedAt = this.now();
    // A crashed create becomes OUTCOME_UNKNOWN first, so this run can resolve it.
    const operationsExpired = await prisma.$transaction((tx) =>
      BillingOperationRepository.expireLapsed(tx, { mode, now: startedAt }),
    );

    const counts = { pages: 0, items: 0, known: 0, bound: 0, unmatched: 0, conflicts: 0, closed: 0 };
    let cursor = await this.openCursor(mode, startedAt);

    if (cursor === null) {
      const state = await prisma.billingProviderState.findUnique({ where: { providerMode: mode } });

      return this.finish(mode, null, state?.orphanWatermark ?? null, counts, operationsExpired, "EMPTY_WINDOW");
    }

    const from = new Date(cursor.watermark.getTime() - this.settings.overlapSeconds * 1000);
    const provider = this.providerFor(ProviderPriority.ORPHAN_DISCOVERY);
    let stoppedBy: OrphanStop | null = null;

    logBillingEvent("orphan.window", { mode, from, to: cursor.windowTo, skip: cursor.skip });

    while (stoppedBy === null) {
      if (counts.pages >= this.settings.maxPagesPerRun) {
        stoppedBy = "MAX_PAGES";
        break;
      }

      if (this.now().getTime() >= options.deadline.getTime()) {
        stoppedBy = "DEADLINE";
        break;
      }

      const page = await provider.listSubscriptions(
        { from, to: cursor.windowTo },
        { count: this.settings.pageSize, skip: cursor.skip },
      );

      if (page.kind === "PROVIDER_DISABLED") {
        stoppedBy = "NOT_ATTEMPTED";
        break;
      }

      if (page.kind === "FAILURE") {
        stoppedBy = page.requestSentAt === undefined ? "NOT_ATTEMPTED" : "FAILED";
        logBillingEvent("orphan.page_failed", { mode, failureClass: page.failureClass, skip: cursor.skip });
        break;
      }

      counts.pages += 1;

      for (const item of page.value.items) {
        counts.items += 1;

        const outcome = await this.handle(mode, item, page.observationAt);

        if (outcome === "KNOWN") counts.known += 1;
        else if (outcome === "BOUND") counts.bound += 1;
        else if (outcome === "UNMATCHED") counts.unmatched += 1;
        else counts.conflicts += 1;
      }

      const complete = page.value.items.length < this.settings.pageSize;
      const next = await this.advance(mode, cursor, page.value.items.length, complete);

      if (next === "MOVED") {
        stoppedBy = "CURSOR_MOVED";
        break;
      }

      if (complete) {
        stoppedBy = "WINDOW_COMPLETE";
        counts.closed = await this.closeExhausted(mode, cursor.windowTo, this.now());
        break;
      }

      cursor = next;
    }

    const state = await prisma.billingProviderState.findUnique({ where: { providerMode: mode } });

    return this.finish(mode, { from, to: cursor.windowTo }, state?.orphanWatermark ?? null, counts, operationsExpired, stoppedBy);
  }

  // -- The cursor -------------------------------------------------------------

  /**
   * The window this run continues, or a new one. A first run (no watermark)
   * starts at the oldest unbound PROVISIONING record, or at now: it never scans
   * the account's history. `null` when the new window would be empty.
   */
  private async openCursor(mode: ProviderMode, now: Date): Promise<Cursor | null> {
    const state = await prisma.billingProviderState.findUnique({ where: { providerMode: mode } });

    if (state?.orphanWatermark && state.orphanWindowTo) {
      return { watermark: state.orphanWatermark, windowTo: state.orphanWindowTo, skip: state.orphanSkip };
    }

    const windowTo = new Date(now.getTime() - this.settings.settleDelaySeconds * 1000);
    let watermark = state?.orphanWatermark ?? null;

    if (watermark === null) {
      const oldest = await prisma.subscription.findFirst({
        where: { providerMode: mode, phase: "PROVISIONING", providerSubscriptionId: null },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      });

      watermark = oldest && oldest.createdAt.getTime() < windowTo.getTime() ? oldest.createdAt : windowTo;

      // Establish coverage from here on, even if there is nothing to scan yet.
      await prisma.billingProviderState.upsert({
        where: { providerMode: mode },
        create: { providerMode: mode, orphanWatermark: watermark },
        update: {},
      });
      await prisma.billingProviderState.updateMany({
        where: { providerMode: mode, orphanWatermark: null },
        data: { orphanWatermark: watermark },
      });
      watermark = (await prisma.billingProviderState.findUniqueOrThrow({ where: { providerMode: mode } })).orphanWatermark!;
    }

    // A window that ends at or before the watermark adds no coverage and could not move it.
    if (windowTo.getTime() <= watermark.getTime()) return null;

    // Open it only if nobody else did (compare-and-set on an empty cursor).
    const opened = await prisma.billingProviderState.updateMany({
      where: { providerMode: mode, orphanWindowTo: null },
      data: { orphanWatermark: watermark, orphanWindowTo: windowTo, orphanSkip: 0 },
    });

    if (opened.count === 0) {
      try {
        await prisma.billingProviderState.create({
          data: { providerMode: mode, orphanWatermark: watermark, orphanWindowTo: windowTo, orphanSkip: 0 },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;

        // The row exists and another run opened a window meanwhile: continue that one.
        const current = await prisma.billingProviderState.findUniqueOrThrow({ where: { providerMode: mode } });

        if (!current.orphanWatermark || !current.orphanWindowTo) return null;

        return { watermark: current.orphanWatermark, windowTo: current.orphanWindowTo, skip: current.orphanSkip };
      }
    }

    return { watermark, windowTo, skip: 0 };
  }

  /**
   * Records a scanned page. Compare-and-set on the cursor, so two concurrent
   * runs cannot both advance it; the loser stops. A complete window moves the
   * watermark to its end — the only way the watermark moves.
   */
  private async advance(mode: ProviderMode, cursor: Cursor, scanned: number, complete: boolean): Promise<Cursor | "MOVED"> {
    const where = { providerMode: mode, orphanWindowTo: cursor.windowTo, orphanSkip: cursor.skip };
    const data = complete
      ? { orphanWatermark: cursor.windowTo, orphanWindowTo: null, orphanSkip: 0 }
      : { orphanSkip: cursor.skip + scanned };
    const { count } = await prisma.billingProviderState.updateMany({ where, data });

    if (count === 0) return "MOVED";

    return complete ? cursor : { ...cursor, skip: cursor.skip + scanned };
  }

  // -- One provider subscription ---------------------------------------------

  private async handle(mode: ProviderMode, item: ProviderSubscriptionState, observationAt: Date): Promise<ItemOutcome> {
    const providerSubscriptionId = item.providerSubscriptionId;
    const known = await prisma.subscription.findUnique({
      where: { providerMode_providerSubscriptionId: { providerMode: mode, providerSubscriptionId } },
      select: { id: true },
    });

    if (known) return "KNOWN";

    const notedMode = item.notes.kz_env?.trim().toUpperCase() || null;
    const notedSubscription = item.notes.kz_sub?.trim() || null;
    const log = { mode, providerSubscriptionId };

    if (notedMode !== null && notedMode !== mode) {
      await this.unmatched(mode, providerSubscriptionId, "PROVIDER_MODE_MISMATCH", { notedMode, resolvedMode: mode });

      return "CONFLICT";
    }

    if (notedSubscription === null) {
      await this.unmatched(mode, providerSubscriptionId, "UNMATCHED_PROVIDER_SUBSCRIPTION", {
        reason: "no Kizunia notes",
        rawStatus: item.rawStatus,
        providerPlanId: item.providerPlanId,
        found: "orphan discovery",
      });

      return "UNMATCHED";
    }

    const now = this.now();
    let bound: string | null = null;

    try {
      bound = await prisma.$transaction(async (tx) => {
        const result = await bindProvisioning(tx, {
          mode,
          providerSubscriptionId,
          subscriptionId: notedSubscription,
          operationId: item.notes.kz_op?.trim() || null,
          trigger: "ORPHAN_DISCOVERY",
          now,
        });

        return result.outcome === "REFUSED" ? null : result.subscriptionId;
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    }

    if (bound === null) {
      await this.unmatched(mode, providerSubscriptionId, "NOTES_CONFLICT", {
        notedSubscriptionId: notedSubscription,
        reason: "kz_sub does not name an unbound PROVISIONING subscription of this mode",
        found: "orphan discovery",
      });

      return "CONFLICT";
    }

    logBillingEvent("orphan.bound", { ...log, subscriptionId: bound, operationId: item.notes.kz_op ?? null });

    await applyObservation(
      bound,
      { state: item, observationAt },
      { resolvedMode: mode, trigger: "ORPHAN_DISCOVERY", now, catalog: this.deps.catalog, schedule: this.deps.schedule },
    );

    return "BOUND";
  }

  private async unmatched(
    mode: ProviderMode,
    providerSubscriptionId: string,
    type: BillingAnomalyType,
    details: Record<string, string>,
  ): Promise<void> {
    const effects = newEffects();
    const log = { mode, providerSubscriptionId };

    await prisma.$transaction((tx) =>
      raiseAnomaly(
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
      ),
    );

    emitEffects(effects);
    logBillingEvent("orphan.unmatched", { ...log, anomaly: type });
  }

  // -- Closing the window ------------------------------------------------------

  /**
   * Closes creates the completed window proves never happened: an unbound
   * PROVISIONING record whose create is OUTCOME_UNKNOWN and was sent (at the
   * latest) `overlap` before the watermark. Anything the provider created in
   * that span would have been listed and bound above.
   */
  private async closeExhausted(mode: ProviderMode, watermark: Date, now: Date): Promise<number> {
    const overlapMs = this.settings.overlapSeconds * 1000;
    const candidates = await prisma.billingOperation.findMany({
      where: {
        providerMode: mode,
        kind: "CREATE_SUBSCRIPTION",
        parentOperationId: null,
        status: "OUTCOME_UNKNOWN",
        subscription: { phase: "PROVISIONING", providerSubscriptionId: null },
      },
      select: { id: true, subscriptionId: true, requestSentAt: true, leaseUntil: true, userId: true },
    });
    let closed = 0;

    for (const operation of candidates) {
      const sentBy = operation.requestSentAt ?? operation.leaseUntil;

      if (sentBy === null || operation.subscriptionId === null) {
        logBillingEvent("orphan.close_skipped", { mode, operationId: operation.id, reason: "no send-time bound" });
        continue;
      }

      if (sentBy.getTime() + overlapMs > watermark.getTime()) continue;

      const subscriptionId = operation.subscriptionId;
      const done = await prisma.$transaction(async (tx) => {
        const abandoned = await abandonProvisioning(tx, {
          subscriptionId,
          operationId: operation.id,
          trigger: "ORPHAN_DISCOVERY",
          now,
        });

        if (!abandoned) return false;

        await BillingOperationRepository.resolveNotApplied(tx, operation.id, now);

        return true;
      });

      if (done) {
        closed += 1;
        logBillingEvent("orphan.closed", { mode, operationId: operation.id, subscriptionId, userId: operation.userId, sentBy, watermark });
      }
    }

    return closed;
  }

  private finish(
    mode: ProviderMode,
    window: { from: Date; to: Date } | null,
    watermark: Date | null,
    counts: { pages: number; items: number; known: number; bound: number; unmatched: number; conflicts: number; closed: number },
    operationsExpired: number,
    stoppedBy: OrphanStop,
  ): OrphanRunResult {
    const result: OrphanRunResult = {
      mode,
      windowFrom: window?.from ?? null,
      windowTo: window?.to ?? null,
      watermark,
      ...counts,
      operationsExpired,
      stoppedBy,
    };

    logBillingEvent("orphan.run", { ...result });

    return result;
  }
}
