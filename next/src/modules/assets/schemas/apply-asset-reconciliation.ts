import { z } from "zod";

/**
 * Upper bound on one reconciliation apply request. Deliberately NOT the same
 * constant as the background sweep's `SWEEP_BATCH_SIZE` (50) — these are
 * independent limits for independent workloads and must never be coupled.
 * The sweep is a cron-paced background loop; apply is one interactive HTTP
 * request in which every id costs a re-read, a row-locked reference
 * recount, a lifecycle transition, and a real provider round-trip, all run
 * SEQUENTIALLY (see AssetReconciliationService.applyToIds). At roughly
 * 300-500ms per provider call, 10 ids is ~3-5s — safe within a Vercel
 * Hobby plan's 10s function ceiling, comfortable on Pro. A larger selection
 * is applied in successive rounds from the UI rather than raising this cap.
 */
export const MAX_RECONCILIATION_APPLY_IDS = 10;

/**
 * The apply request carries Asset ids and nothing else — no target status,
 * no trusted preview state. The server re-reads each row and re-evaluates
 * eligibility itself; a client can never assert "this Asset is a genuine
 * orphan" through this endpoint. See AssetReconciliationService.applyToIds.
 */
export const ApplyAssetReconciliationSchema = z.object({
  ids: z
    .array(z.string().cuid())
    .min(1, "At least one asset id is required.")
    .max(
      MAX_RECONCILIATION_APPLY_IDS,
      `A reconciliation apply cannot target more than ${MAX_RECONCILIATION_APPLY_IDS} assets at once.`,
    ),
});

export type ApplyAssetReconciliationInput = z.infer<
  typeof ApplyAssetReconciliationSchema
>;
