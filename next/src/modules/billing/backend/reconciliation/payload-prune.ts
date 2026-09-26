/**
 * Billing — The `billing:payload-prune` Task (Phase VIII)
 *
 * Webhook payloads may carry customer contact details, so `BillingEvent.rawPayload`
 * is kept only for the retention horizon (180 days by default, B3). After it the
 * payload is **nulled and `payloadPrunedAt` stamped; the row is never deleted**:
 * the event's metadata, its money facts and the history that references it all
 * stay (docs/architecture/subscription/implementation/database-design.md).
 *
 * Bounded, and safe to run in production and concurrently:
 *
 *  - each batch is ONE autocommit statement (`UPDATE … WHERE id IN (SELECT … LIMIT n
 *    FOR UPDATE SKIP LOCKED)`), so there is no long transaction and no long lock;
 *  - a run stops at the batch ceiling, at its wall-clock deadline, or when
 *    nothing eligible is left, and the next run continues;
 *  - `SKIP LOCKED` makes two overlapping runs take different rows, so neither
 *    blocks the other or counts a row twice;
 *  - oldest first, served by the partial index on `receivedAt WHERE rawPayload
 *    IS NOT NULL`.
 *
 * Database-only: no provider call. Registered in the tick (daily, IB-10 order)
 * and runnable by hand at `GET /api/v1/internal/billing/payload-prune`. Logs
 * counts and the cutoff, never a payload.
 */
import { Prisma } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { RETENTION_CONFIG } from "../../config/billing-config";
import { logBillingEvent } from "../../observability/log";
import { utc } from "../sql";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PayloadPruneSettings {
  readonly retentionDays: number;
  readonly batchSize: number;
  readonly maxBatches: number;
  readonly wallClockMs: number;
}

export interface PayloadPruneTaskDeps {
  readonly now?: () => Date;
  readonly settings?: Partial<PayloadPruneSettings>;
}

/** Why a run stopped: nothing eligible left, the batch ceiling, or the deadline. */
export type PayloadPruneStop = "EMPTY" | "MAX_BATCHES" | "DEADLINE";

export interface PayloadPruneResult {
  readonly cutoff: string;
  readonly batches: number;
  readonly pruned: number;
  readonly stoppedBy: PayloadPruneStop;
  readonly durationMs: number;
}

export class PayloadPruneTask {
  private readonly now: () => Date;
  private readonly settings: PayloadPruneSettings;

  constructor(deps: PayloadPruneTaskDeps = {}) {
    this.now = deps.now ?? (() => new Date());
    this.settings = {
      retentionDays: RETENTION_CONFIG.payloadRetentionDays,
      batchSize: RETENTION_CONFIG.pruneBatchSize,
      maxBatches: RETENTION_CONFIG.pruneMaxBatchesPerRun,
      wallClockMs: RETENTION_CONFIG.pruneWallClockMs,
      ...deps.settings,
    };
  }

  /** `budgetMs` overrides the configured wall-clock budget (the tick passes its own). */
  async run(options: { readonly budgetMs?: number } = {}): Promise<Record<string, unknown>> {
    const { retentionDays, batchSize, maxBatches, wallClockMs } = this.settings;
    const startedAt = this.now();
    const deadline = startedAt.getTime() + (options.budgetMs ?? wallClockMs);
    const cutoff = new Date(startedAt.getTime() - retentionDays * DAY_MS);

    let batches = 0;
    let pruned = 0;
    let stoppedBy: PayloadPruneStop = "EMPTY";

    for (;;) {
      if (batches >= maxBatches) {
        stoppedBy = "MAX_BATCHES";
        break;
      }
      if (this.now().getTime() >= deadline) {
        stoppedBy = "DEADLINE";
        break;
      }

      const count = await this.pruneBatch(cutoff, batchSize);

      batches += 1;
      pruned += count;

      // A short batch means the eligible rows are exhausted.
      if (count < batchSize) {
        stoppedBy = "EMPTY";
        break;
      }
    }

    const result: PayloadPruneResult = {
      cutoff: cutoff.toISOString(),
      batches,
      pruned,
      stoppedBy,
      durationMs: this.now().getTime() - startedAt.getTime(),
    };

    logBillingEvent("payload.pruned", { ...result });

    return { ...result };
  }

  /** One short statement: nulls up to `limit` payloads received before `cutoff`, oldest first. Returns the count. */
  private async pruneBatch(cutoff: Date, limit: number): Promise<number> {
    return prisma.$executeRaw(Prisma.sql`
      UPDATE "public"."billing_event"
      SET "rawPayload" = NULL, "payloadPrunedAt" = ${utc(this.now())}
      WHERE "id" IN (
        SELECT "id" FROM "public"."billing_event"
        WHERE "rawPayload" IS NOT NULL AND "receivedAt" < ${utc(cutoff)}
        ORDER BY "receivedAt" ASC, "id" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )`);
  }
}
