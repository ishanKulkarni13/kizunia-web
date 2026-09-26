/**
 * Billing — Health Summary Aggregation (Phase VIII)
 *
 * The pure half of `GET /api/v1/admin/billing/health`: raw rows in, the
 * summary out, with no I/O, so every rule (ages, cooldown activity, always
 * listing both modes, stable ordering, tasks that never ran) is unit-tested.
 * `HealthService` reads the tables and passes them here.
 *
 * Everything is derived from Kizunia's own tables: the health endpoint is the
 * metrics substitute until the Phase IX alert channel exists.
 */
import type {
  BillingAnomalyType,
  BillingOperationKind,
  ProviderFailureClass,
  ProviderMode,
  SubscriptionPhase,
  SyncReason,
} from "@/generated/prisma";

import type { ResolvedProviderMode } from "../../provider/provider-mode";
import type { BillingHealthDTO } from "./admin-billing.dto";
import { ageSeconds, iso } from "./admin-mappers";

/** The billing tasks the tick runs, whose last run the summary reports. */
export const HEALTH_TASK_IDS = ["billing:sync", "billing:orphan-discovery", "billing:payload-prune"] as const;

const MODES: readonly ProviderMode[] = ["TEST", "LIVE"];

const PHASE_ORDER: readonly SubscriptionPhase[] = [
  "PROVISIONING",
  "PENDING_AUTHENTICATION",
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "HALTED",
  "PAUSED",
  "CANCELLED",
  "EXPIRED",
  "COMPLETED",
  "ABANDONED",
];

export interface HealthInputs {
  readonly now: Date;
  readonly providerMode: ResolvedProviderMode;
  readonly expectedMode: ProviderMode;
  readonly phaseCounts: readonly { providerMode: ProviderMode; phase: SubscriptionPhase; count: number }[];
  /** Bound rows with a due time at or before `now`, per mode. */
  readonly due: readonly { providerMode: ProviderMode; count: number; oldestDueAt: Date | null }[];
  /** The oldest due rows, already ordered and bounded. */
  readonly oldestDue: readonly {
    id: string;
    userId: string | null;
    providerMode: ProviderMode;
    syncDueAt: Date;
    syncReason: SyncReason | null;
    syncAttempts: number;
    lastSyncFailureClass: ProviderFailureClass | null;
  }[];
  readonly openAnomalies: readonly { type: BillingAnomalyType; count: number }[];
  readonly outcomeUnknown: {
    readonly count: number;
    /** The oldest, ordered and bounded. */
    readonly oldest: readonly {
      id: string;
      kind: BillingOperationKind;
      providerMode: ProviderMode;
      userId: string | null;
      subscriptionId: string | null;
      createdAt: Date;
    }[];
  };
  readonly jobRuns: readonly {
    taskId: string;
    lastRunAt: Date | null;
    lastStatus: string | null;
    lastError: string | null;
    runCount: number;
  }[];
  readonly providerStates: readonly {
    providerMode: ProviderMode;
    cooldownUntil: Date | null;
    cooldownLevel: number;
    consecutiveFailures: number;
    authFailurePinnedKeyFingerprint: string | null;
    orphanWatermark: Date | null;
    orphanWindowTo: Date | null;
  }[];
  readonly webhooks: readonly {
    providerMode: ProviderMode;
    lastReceivedAt: Date | null;
    lastPreviousSecretAt: Date | null;
  }[];
}

/** The summary before the service adds the viewer's permissions. */
export type BillingHealthSummary = Omit<BillingHealthDTO, "permissions">;

export function buildHealthSummary(input: HealthInputs): BillingHealthSummary {
  const { now } = input;

  const subscriptionsByPhase = input.phaseCounts
    .filter((row) => row.count > 0)
    .map((row) => ({ providerMode: row.providerMode, phase: row.phase, count: row.count }))
    .sort(
      (a, b) =>
        MODES.indexOf(a.providerMode) - MODES.indexOf(b.providerMode) ||
        PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase),
    );

  const dueBacklog = MODES.map((mode) => {
    const row = input.due.find((r) => r.providerMode === mode);
    const oldestDueAt = row?.oldestDueAt ?? null;

    return {
      providerMode: mode,
      count: row?.count ?? 0,
      oldestDueAt: iso(oldestDueAt),
      oldestDueAgeSeconds: ageSeconds(oldestDueAt, now),
    };
  });

  const openAnomaliesByType = input.openAnomalies
    .filter((row) => row.count > 0)
    .map((row) => ({ type: row.type, count: row.count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

  const oldestUnknown = input.outcomeUnknown.oldest[0]?.createdAt ?? null;

  return {
    generatedAt: now.toISOString(),
    providerMode: input.providerMode,
    expectedMode: input.expectedMode,
    subscriptionsByPhase,
    dueBacklog,
    oldestDue: input.oldestDue.map((row) => ({
      subscriptionId: row.id,
      userId: row.userId,
      providerMode: row.providerMode,
      syncDueAt: row.syncDueAt.toISOString(),
      syncReason: row.syncReason,
      syncAttempts: row.syncAttempts,
      lastSyncFailureClass: row.lastSyncFailureClass,
    })),
    openAnomaliesByType,
    outcomeUnknown: {
      count: input.outcomeUnknown.count,
      oldestCreatedAt: iso(oldestUnknown),
      oldestAgeSeconds: ageSeconds(oldestUnknown, now),
      oldest: input.outcomeUnknown.oldest.map((row) => ({
        operationId: row.id,
        kind: row.kind,
        providerMode: row.providerMode,
        userId: row.userId,
        subscriptionId: row.subscriptionId,
        createdAt: row.createdAt.toISOString(),
        ageSeconds: ageSeconds(row.createdAt, now) ?? 0,
      })),
    },
    jobs: HEALTH_TASK_IDS.map((taskId) => {
      const row = input.jobRuns.find((r) => r.taskId === taskId);

      return {
        taskId,
        lastRunAt: iso(row?.lastRunAt),
        lastStatus: row?.lastStatus ?? null,
        lastError: row?.lastError ?? null,
        runCount: row?.runCount ?? 0,
      };
    }),
    providerState: MODES.map((mode) => {
      const row = input.providerStates.find((r) => r.providerMode === mode);
      const cooldownUntil = row?.cooldownUntil ?? null;

      return {
        providerMode: mode,
        cooldownActive: cooldownUntil !== null && cooldownUntil.getTime() > now.getTime(),
        cooldownUntil: iso(cooldownUntil),
        cooldownLevel: row?.cooldownLevel ?? 0,
        consecutiveFailures: row?.consecutiveFailures ?? 0,
        authFailurePinned: (row?.authFailurePinnedKeyFingerprint ?? null) !== null,
        orphanWatermark: iso(row?.orphanWatermark),
        orphanWindowTo: iso(row?.orphanWindowTo),
      };
    }),
    webhooks: MODES.map((mode) => {
      const row = input.webhooks.find((r) => r.providerMode === mode);

      return {
        providerMode: mode,
        lastReceivedAt: iso(row?.lastReceivedAt),
        lastReceivedAgeSeconds: ageSeconds(row?.lastReceivedAt, now),
        lastPreviousSecretMatchAt: iso(row?.lastPreviousSecretAt),
      };
    }),
  };
}
