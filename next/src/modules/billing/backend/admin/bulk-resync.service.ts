/**
 * Billing — Admin Bulk Re-sync (Phase VIII)
 *
 * The runbook's catch-up tool after a webhook outage, a restore or a rate-limit
 * incident: mark matching subscriptions due, optionally only those last synced
 * before a time. `MANAGE_BILLING` (SUPER_ADMIN only, IB-15), with a mandatory
 * reason.
 *
 * **It only marks rows due.** This service has no provider dependency and
 * makes no provider call: the marked rows drain through the existing
 * `billing:sync` path at priority 3, inside the request budget and behind the
 * cooldown, exactly like any other due row (IB-28 item 3). Marking is the same
 * write as `markDue`, in bounded batches (`SyncClaimRepository.markDueBulk`).
 *
 * Scope: the resolved provider mode's bound, non-terminal subscriptions. With
 * billing disabled there is no mode and nothing would drain, so it refuses
 * with `503` like the other billing commands.
 */
import type { StrictAuthorizationActor } from "@/authorization";
import { PlatformContextResolver } from "@/authorization/platform/resolver";

import { BULK_RESYNC_CONFIG } from "../../config/billing-config";
import { BillingUnavailableError } from "../../errors";
import { logBillingEvent } from "../../observability/log";
import { getProviderMode, type ResolvedProviderMode } from "../../provider/provider-mode";
import { BulkResyncSchema, type BulkResyncInput } from "../../schemas/admin";
import { BillingAuthorizer } from "../authorization/authorizer";
import { SyncClaimRepository } from "../sync/claim.repository";
import type { BulkResyncResultDTO } from "./admin-billing.dto";

export interface BulkResyncServiceDeps {
  readonly now?: () => Date;
  readonly resolvedMode?: () => ResolvedProviderMode;
  readonly batchSize?: number;
}

export class BulkResyncService {
  constructor(private readonly deps: BulkResyncServiceDeps = {}) {}

  async resync(actor: StrictAuthorizationActor, input: BulkResyncInput): Promise<BulkResyncResultDTO> {
    const context = await PlatformContextResolver.resolve(actor);
    BillingAuthorizer.manageBilling(context);

    // The service enforces the reason itself, so a caller that skips the controller cannot re-sync without one.
    const { reason, lastSyncedBefore, dryRun = false } = BulkResyncSchema.parse(input);

    const mode = (this.deps.resolvedMode ?? getProviderMode)();
    if (mode === "DISABLED") throw new BillingUnavailableError();

    const now = (this.deps.now ?? (() => new Date()))();
    const result = await SyncClaimRepository.markDueBulk({
      mode,
      lastSyncedBefore: lastSyncedBefore ? new Date(lastSyncedBefore) : undefined,
      now,
      batchSize: this.deps.batchSize ?? BULK_RESYNC_CONFIG.batchSize,
      dryRun,
    });

    logBillingEvent(dryRun ? "resync.bulk_previewed" : "resync.bulk_marked", {
      actorUserId: actor.id,
      mode,
      reason,
      lastSyncedBefore: lastSyncedBefore ?? null,
      matched: result.matched,
      marked: result.marked,
    });

    return {
      mode,
      dryRun,
      lastSyncedBefore: lastSyncedBefore ? new Date(lastSyncedBefore).toISOString() : null,
      matched: result.matched,
      marked: result.marked,
    };
  }
}
