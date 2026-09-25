/**
 * Billing — Admin "Sync Now"
 *
 * One subscription, synchronized on an administrator's request: a runbook
 * hook for "Razorpay says one thing, Kizunia shows another"
 * (docs/architecture/subscription/cross-cutting/operations-runbook.md).
 *
 * - Requires `VIEW_BILLING` (ADMIN, SUPER_ADMIN; IB-15): it only **reads**
 *   from Razorpay, so it is not a billing mutation, and it takes no
 *   `Idempotency-Key` (IB-6 covers provider mutations; IB-24 item 11).
 * - Priority 1: an administrator is waiting, and it may run during a cooldown.
 * - Through the same targeted claim and apply path as every other sync; a row
 *   another worker holds is refused with `409`, since that worker's fetch will
 *   apply.
 * - The response carries no provider identifier (SB-PB-04).
 */
import type { StrictAuthorizationActor } from "@/authorization";
import { PlatformContextResolver } from "@/authorization/platform/resolver";
import type {
  BillingCycle,
  MembershipPlan,
  ProviderFailureClass,
  SubscriptionPhase,
} from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { BillingSyncInProgressError, SubscriptionNotFoundError, SubscriptionNotSyncableError } from "../errors/sync-errors";
import { logBillingEvent } from "../observability/log";
import { assertBillingProviderEnabled } from "../provider/provider-mode";
import { ProviderPriority } from "../provider/types";
import { BillingAuthorizer } from "./authorization/authorizer";
import { SyncService, type SyncOutcome } from "./sync/sync.service";

export interface SubscriptionSyncDTO {
  readonly subscriptionId: string;
  /** What this sync did: APPLIED, NO_CHANGE, STALE_DISCARDED, REJECTED, FAILED, NOT_ATTEMPTED, MODE_MISMATCH, ERROR. */
  readonly outcome: SyncOutcome;
  readonly failureClass: ProviderFailureClass | null;
  readonly phase: SubscriptionPhase;
  readonly plan: MembershipPlan;
  readonly cycle: BillingCycle;
  readonly lastSyncedAt: string | null;
  readonly syncDueAt: string | null;
  readonly syncAttempts: number;
  readonly lastSyncFailureClass: ProviderFailureClass | null;
}

export interface AdminSyncServiceDeps {
  readonly sync?: SyncService;
  /** Raises `503 BILLING_UNAVAILABLE` when billing is disabled. */
  readonly assertEnabled?: () => void;
}

export class AdminSyncService {
  constructor(private readonly deps: AdminSyncServiceDeps = {}) {}

  async syncNow(actor: StrictAuthorizationActor, subscriptionId: string): Promise<SubscriptionSyncDTO> {
    const context = await PlatformContextResolver.resolve(actor);
    BillingAuthorizer.viewBilling(context);

    (this.deps.assertEnabled ?? assertBillingProviderEnabled)();

    const sync = this.deps.sync ?? new SyncService();
    const result = await sync.syncTargeted(subscriptionId, ProviderPriority.COMMAND, {
      trigger: "ADMIN_SYNC",
      actorUserId: actor.id,
    });

    switch (result.outcome) {
      case "NOT_FOUND":
        throw new SubscriptionNotFoundError();
      case "LEASED":
        throw new BillingSyncInProgressError();
      case "NOT_SYNCABLE":
        throw new SubscriptionNotSyncableError();
      default:
        break;
    }

    const row = await prisma.subscription.findUnique({ where: { id: subscriptionId } });

    if (!row) throw new SubscriptionNotFoundError();

    logBillingEvent("sync.admin", {
      subscriptionId,
      userId: row.userId,
      actorUserId: actor.id,
      outcome: result.outcome,
      failureClass: result.failureClass ?? null,
    });

    return {
      subscriptionId: row.id,
      outcome: result.outcome,
      failureClass: result.failureClass ?? null,
      phase: row.phase,
      plan: row.plan,
      cycle: row.cycle,
      lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
      syncDueAt: row.syncDueAt?.toISOString() ?? null,
      syncAttempts: row.syncAttempts,
      lastSyncFailureClass: row.lastSyncFailureClass,
    };
  }
}
