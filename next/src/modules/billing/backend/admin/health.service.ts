/**
 * Billing — Health Service (Phase VIII)
 *
 * `GET /api/v1/admin/billing/health`: is billing healthy? Computed from
 * Kizunia's tables only, on demand, in a handful of small grouped queries:
 *
 *  - subscriptions by mode and phase;
 *  - the due backlog (count and oldest) and the oldest due rows;
 *  - open anomalies by type;
 *  - `OUTCOME_UNKNOWN` operations (count, oldest, and the oldest few);
 *  - the last run of `billing:sync`, `billing:orphan-discovery` and
 *    `billing:payload-prune` from the tick's `internal_job_run` marker;
 *  - per mode: cooldown state, orphan-discovery watermark, the last webhook
 *    received, and the last one verified by the previous secret (the secret
 *    rotation check, runbook);
 *  - the provider mode.
 *
 * It works with billing disabled (the mode then reads `DISABLED`): nothing
 * here needs a provider. `VIEW_BILLING` (ADMIN, SUPER_ADMIN). Read-only.
 *
 * "Last `billing:sync` result" is what the marker records (when it last ran and
 * whether it succeeded or failed). The run's own counts are logged as
 * `sync.run`; they are not persisted (IB-28 item 7).
 */
import type { StrictAuthorizationActor } from "@/authorization";
import { PlatformContextResolver } from "@/authorization/platform/resolver";
import type { ProviderMode } from "@/generated/prisma";
import { expectedBillingMode } from "@/lib/entitlements";
import prisma from "@/lib/prisma";

import { getProviderMode, type ResolvedProviderMode } from "../../provider/provider-mode";
import { BillingAuthorizer } from "../authorization/authorizer";
import type { BillingHealthDTO } from "./admin-billing.dto";
import { adminPermissions } from "./admin-mappers";
import { buildHealthSummary, HEALTH_TASK_IDS } from "./health-summary";

/** How many of the oldest due rows and `OUTCOME_UNKNOWN` operations are listed. */
export const HEALTH_LIST_LIMIT = 10;

export interface HealthServiceDeps {
  readonly now?: () => Date;
  readonly resolvedMode?: () => ResolvedProviderMode;
  readonly expectedMode?: () => ProviderMode;
}

export class BillingHealthService {
  constructor(private readonly deps: HealthServiceDeps = {}) {}

  async summary(actor: StrictAuthorizationActor): Promise<BillingHealthDTO> {
    const context = await PlatformContextResolver.resolve(actor);
    BillingAuthorizer.viewBilling(context);

    const now = (this.deps.now ?? (() => new Date()))();
    const due = { syncDueAt: { lte: now }, providerSubscriptionId: { not: null } } as const;

    const [
      phaseCounts,
      dueGroups,
      oldestDue,
      openAnomalies,
      unknownCount,
      oldestUnknown,
      jobRuns,
      providerStates,
      lastWebhooks,
      lastPreviousSecret,
    ] = await Promise.all([
      prisma.subscription.groupBy({ by: ["providerMode", "phase"], _count: { _all: true } }),
      prisma.subscription.groupBy({
        by: ["providerMode"],
        where: due,
        _count: { _all: true },
        _min: { syncDueAt: true },
      }),
      prisma.subscription.findMany({
        where: due,
        orderBy: [{ syncDueAt: "asc" }, { id: "asc" }],
        take: HEALTH_LIST_LIMIT,
        select: {
          id: true,
          userId: true,
          providerMode: true,
          syncDueAt: true,
          syncReason: true,
          syncAttempts: true,
          lastSyncFailureClass: true,
        },
      }),
      prisma.billingAnomaly.groupBy({ by: ["type"], where: { resolvedAt: null }, _count: { _all: true } }),
      prisma.billingOperation.count({ where: { status: "OUTCOME_UNKNOWN" } }),
      prisma.billingOperation.findMany({
        where: { status: "OUTCOME_UNKNOWN" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: HEALTH_LIST_LIMIT,
        select: { id: true, kind: true, providerMode: true, userId: true, subscriptionId: true, createdAt: true },
      }),
      prisma.internalJobRun.findMany({ where: { taskId: { in: [...HEALTH_TASK_IDS] } } }),
      prisma.billingProviderState.findMany(),
      prisma.billingEvent.groupBy({ by: ["providerMode"], _max: { receivedAt: true } }),
      prisma.billingEvent.groupBy({
        by: ["providerMode"],
        where: { matchedSecret: "PREVIOUS" },
        _max: { receivedAt: true },
      }),
    ]);

    const summary = buildHealthSummary({
      now,
      providerMode: (this.deps.resolvedMode ?? getProviderMode)(),
      expectedMode: (this.deps.expectedMode ?? expectedBillingMode)(),
      phaseCounts: phaseCounts.map((row) => ({
        providerMode: row.providerMode,
        phase: row.phase,
        count: row._count._all,
      })),
      due: dueGroups.map((row) => ({
        providerMode: row.providerMode,
        count: row._count._all,
        oldestDueAt: row._min.syncDueAt,
      })),
      oldestDue: oldestDue.flatMap((row) => (row.syncDueAt ? [{ ...row, syncDueAt: row.syncDueAt }] : [])),
      openAnomalies: openAnomalies.map((row) => ({ type: row.type, count: row._count._all })),
      outcomeUnknown: { count: unknownCount, oldest: oldestUnknown },
      jobRuns,
      providerStates,
      webhooks: (["TEST", "LIVE"] as const).map((mode) => ({
        providerMode: mode,
        lastReceivedAt: lastWebhooks.find((row) => row.providerMode === mode)?._max.receivedAt ?? null,
        lastPreviousSecretAt: lastPreviousSecret.find((row) => row.providerMode === mode)?._max.receivedAt ?? null,
      })),
    });

    return { ...summary, permissions: adminPermissions(context) };
  }
}
