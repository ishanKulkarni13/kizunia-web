/**
 * Billing — The Apply Path
 *
 * **The** write path for provider state (SB-CM-05, SB-RC-04). Every
 * observation — a webhook-triggered fetch, a due reconciliation, an admin
 * "sync now", and from Phase V a command response or a checkout confirmation —
 * becomes Kizunia state here and nowhere else
 * (docs/architecture/subscription/implementation/synchronization.md).
 *
 * One transaction, holding the subscription's row lock:
 *
 *   1. stale guard: an observation whose request was sent no later than the
 *      last applied one is discarded (SB-RC-08). Send time orders observations
 *      correctly whatever order the responses arrive in.
 *   2. validation: mode, notes, status, plan catalog. A failure changes no
 *      phase, plan or access; it raises an anomaly (or, for an unknown status,
 *      an alert) and backs the row off.
 *   3. terminal guard: a terminal subscription is never moved out of its
 *      phase; the contradiction is an anomaly.
 *   4. the write: phase (through the one mapping), plan and cycle (through the
 *      catalog), periods, the scheduled change, `cancelAtPeriodEnd` (cleared
 *      only by an observed cancellation, never by an absent field),
 *      `firstContributedAt`, the advisory payment method.
 *   5. history for every access-relevant change, with its cause and trigger;
 *      operations this observation settles; anomalies it proves stale.
 *   6. bookkeeping: the watermark, and the next due time. If an event-driven
 *      trigger arrived after this request was sent (`syncRequestedAt >
 *      observationAt`), the row stays due now, so the event is always observed
 *      by a fetch sent after it.
 *   7. on a phase change, the open-subscription count (`MULTIPLE_OPEN_SUBSCRIPTIONS`).
 *
 * The payload status of a webhook never reaches this function: only fetched
 * or command-returned provider state does (SB-WH-03). No provider call happens
 * here, and the commit *is* the access change, because effective access is
 * computed on read from these rows.
 *
 * Logs and alerts are emitted after the commit, so a rolled-back transaction
 * never reports anything.
 */
import type {
  BillingAnomalyType,
  BillingCycle,
  HistoryTrigger,
  MembershipPlan,
  Prisma,
  ProviderFailureClass,
  ProviderMode,
  Subscription,
  SubscriptionPhase,
} from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { SYNC_SCHEDULE_CONFIG } from "../../config/billing-config";
import { getPlanCatalog, type PlanCatalog } from "../../config/plan-catalog";
import {
  BillingAlertCondition,
  logBillingAlert,
  logBillingEvent,
  type BillingAlertSeverity,
} from "../../observability/log";
import { nextDue, type NextDueSettings } from "../../policy/next-due";
import { validateObservation, type ObservationProblem } from "../../policy/observation-validation";
import { settleOperations } from "../../policy/operation-settlement";
import { applyScheduledChange } from "../../policy/scheduled-change";
import { isContributingPhase, isTerminalPhase, mapPhase } from "../../policy/state-mapping";
import type { ProviderSubscriptionState } from "../../provider/types";
import { AnomalySubject, BillingAnomalyRepository, type AnomalyInput } from "../anomalies/anomaly.repository";
import {
  historyTriggerFor,
  SubscriptionHistoryRepository,
  type HistoryEntryInput,
} from "../history/history.repository";
import { recordSyncFailure } from "./sync-failure.repository";

export interface Observation {
  readonly state: ProviderSubscriptionState;
  /** When the request that produced `state` was SENT. */
  readonly observationAt: Date;
}

export interface ApplyContext {
  /** The provider mode this process runs in. */
  readonly resolvedMode: ProviderMode;
  /** How Kizunia found out. Defaults to the row's `syncReason`. */
  readonly trigger?: HistoryTrigger;
  /** The admin behind an `ADMIN_SYNC`. */
  readonly actorUserId?: string | null;
  /**
   * The command whose own response this observation is (`COMMAND_RESPONSE`):
   * its history is caused by that operation, which the command settles itself.
   */
  readonly commandOperationId?: string | null;
  readonly now?: Date;
  readonly catalog?: PlanCatalog;
  readonly schedule?: NextDueSettings;
  readonly random?: () => number;
}

export type ApplyRejection = ObservationProblem | "TERMINAL_STATE_CONTRADICTED";

export type ApplyResult =
  | {
      readonly outcome: "APPLIED";
      readonly previousPhase: SubscriptionPhase;
      readonly phase: SubscriptionPhase;
      /** Whether anything access-relevant changed (phase, plan, scheduled change, cancel flag). */
      readonly changed: boolean;
      readonly nextDueAt: Date | null;
    }
  | { readonly outcome: "STALE_DISCARDED" }
  | { readonly outcome: "REJECTED"; readonly rejection: ApplyRejection; readonly failureClass: ProviderFailureClass | null }
  | { readonly outcome: "SUBSCRIPTION_NOT_FOUND" };

/** Anomaly types an applied observation proves stale, and how each is keyed (IB-24 item 6). */
const SELF_CLEARING: readonly { type: BillingAnomalyType; subject: (row: Subscription) => string | null }[] = [
  {
    type: "PROVIDER_SUBSCRIPTION_MISSING",
    subject: (row) => (row.providerSubscriptionId ? AnomalySubject.providerSubscription(row.providerSubscriptionId) : null),
  },
  { type: "UNMAPPED_PROVIDER_PLAN", subject: (row) => AnomalySubject.subscription(row.id) },
];

export interface Effects {
  readonly alerts: { condition: string; severity: BillingAlertSeverity; fields: Record<string, unknown> }[];
  readonly events: { event: string; fields: Record<string, unknown> }[];
}

export async function applyObservation(
  subscriptionId: string,
  observation: Observation,
  context: ApplyContext,
): Promise<ApplyResult> {
  const effects = newEffects();

  const result = await prisma.$transaction((tx) =>
    applyObservationInTransaction(tx, subscriptionId, observation, context, effects),
  );

  emitEffects(effects);

  return result;
}

/**
 * The same apply, inside a transaction the caller owns: a command's settle
 * transaction binds the provider ID, applies the returned entity and settles
 * its operation atomically (command-model step 7, IB-25 item 1). The caller
 * emits `effects` after its commit, so a rolled-back transaction reports
 * nothing.
 */
export async function applyObservationInTransaction(
  tx: Prisma.TransactionClient,
  subscriptionId: string,
  observation: Observation,
  context: ApplyContext,
  effects: Effects,
): Promise<ApplyResult> {
  await tx.$executeRaw`SELECT 1 FROM "public"."subscription" WHERE "id" = ${subscriptionId} FOR UPDATE`;
  const row = await tx.subscription.findUnique({ where: { id: subscriptionId } });

  if (!row) return { outcome: "SUBSCRIPTION_NOT_FOUND" };

  return applyLocked(tx, row, observation, context, effects);
}

export function newEffects(): Effects {
  return { alerts: [], events: [] };
}

/** Logs what a committed transaction decided. Call only after the commit. */
export function emitEffects(effects: Effects): void {
  for (const { event, fields } of effects.events) logBillingEvent(event, fields);
  for (const { condition, severity, fields } of effects.alerts) logBillingAlert(condition, severity, fields);
}

async function applyLocked(
  tx: Prisma.TransactionClient,
  row: Subscription,
  { state, observationAt }: Observation,
  context: ApplyContext,
  effects: Effects,
): Promise<ApplyResult> {
  const now = context.now ?? new Date();
  const catalog = context.catalog ?? getPlanCatalog(context.resolvedMode);
  const schedule = context.schedule ?? SYNC_SCHEDULE_CONFIG;
  const trigger = context.trigger ?? historyTriggerFor(row.syncReason);
  const log = { subscriptionId: row.id, userId: row.userId, mode: row.providerMode, trigger };

  // 1. Stale guard (SB-RC-08).
  if (row.lastAppliedObservationAt && observationAt.getTime() <= row.lastAppliedObservationAt.getTime()) {
    effects.events.push({
      event: "sync.stale_discarded",
      fields: { ...log, observationAt, lastAppliedObservationAt: row.lastAppliedObservationAt },
    });

    return { outcome: "STALE_DISCARDED" };
  }

  // 2. Validation.
  const verdict = validateObservation({
    subscriptionId: row.id,
    rowMode: row.providerMode,
    resolvedMode: context.resolvedMode,
    rawStatus: state.rawStatus,
    providerPlanId: state.providerPlanId,
    notes: state.notes,
    findPlan: (id) => catalog.findByProviderPlanId(id),
  });

  if (!verdict.ok) return reject(tx, row, verdict.problem, verdict.detail, now, context, effects, log);

  const mapped = mapPhase({
    rawStatus: state.rawStatus,
    kind: row.kind,
    startAt: state.startAt,
    now,
    trialConversionGraceSeconds: schedule.trialConversionGraceSeconds,
  });

  if (!mapped.applied) {
    return reject(tx, row, "UNKNOWN_STATUS", { rawStatus: state.rawStatus }, now, context, effects, log);
  }

  // 3. Terminal guard: Razorpay documents terminal states as final.
  if (isTerminalPhase(row.phase) && mapped.phase !== row.phase) {
    return reject(
      tx,
      row,
      "TERMINAL_STATE_CONTRADICTED",
      { localPhase: row.phase, observedPhase: mapped.phase },
      now,
      context,
      effects,
      log,
    );
  }

  // 4. The write.
  const phase = mapped.phase;
  const previousSnapshot = (row.providerSnapshot ?? null) as { hasScheduledChanges?: unknown } | null;
  const scheduled = applyScheduledChange({
    current: {
      scheduledPlan: row.scheduledPlan,
      scheduledCycle: row.scheduledCycle,
      scheduledProviderPlanId: row.scheduledProviderPlanId,
      scheduledChangeAt: row.scheduledChangeAt,
      scheduledByOperationId: row.scheduledByOperationId,
    },
    previouslyFlagged: previousSnapshot?.hasScheduledChanges === true,
    hasScheduledChanges: state.hasScheduledChanges,
    changeScheduledAt: state.changeScheduledAt,
    observedPlan: verdict.plan,
    observedCycle: verdict.cycle,
  });

  const cancelFlagCleared = row.cancelAtPeriodEnd && phase === "CANCELLED";
  const recoveredFromHalt = row.phase === "HALTED" && phase === "ACTIVE";

  // 5a. Operations this observation settles.
  const openOperations = await tx.billingOperation.findMany({
    where: { subscriptionId: row.id, status: "OUTCOME_UNKNOWN" },
    select: { id: true, kind: true, status: true, requestSentAt: true, request: true },
  });
  const decisions = settleOperations(openOperations, {
    observationAt,
    rawStatus: state.rawStatus,
    plan: verdict.plan,
    cycle: verdict.cycle,
    hasScheduledChanges: state.hasScheduledChanges,
    scheduledPlan: scheduled.next.scheduledPlan,
    scheduledCycle: scheduled.next.scheduledCycle,
  });
  let settledOperationId: string | null = null;

  for (const decision of decisions) {
    if (decision.status === "UNPARSEABLE_REQUEST") {
      effects.events.push({ event: "sync.operation_unparseable", fields: { ...log, operationId: decision.operationId } });
      continue;
    }

    await tx.billingOperation.update({
      where: { id: decision.operationId },
      data: { status: decision.status, resolvedAt: now },
    });
    effects.events.push({
      event: "command.settled",
      fields: { ...log, operationId: decision.operationId, status: decision.status, by: "observation" },
    });

    if (decision.status === "SUCCEEDED") settledOperationId ??= decision.operationId;
  }

  // 5b. History.
  settledOperationId ??= context.commandOperationId ?? null;
  const cause = settledOperationId ? "KIZUNIA_COMMAND" : "PROVIDER_OBSERVED";
  const billingEventId =
    trigger === "WEBHOOK" ? await SubscriptionHistoryRepository.triggeringEventId(tx, row.id, observationAt) : null;
  const entry = (change: HistoryEntryInput["change"], fromValue: string | null, toValue: string | null) => ({
    subscriptionId: row.id,
    userId: row.userId,
    change,
    fromValue,
    toValue,
    cause,
    trigger,
    operationId: settledOperationId,
    billingEventId,
    actorUserId: trigger === "ADMIN_SYNC" ? (context.actorUserId ?? null) : null,
    observationAt,
  } satisfies HistoryEntryInput);

  const history: HistoryEntryInput[] = [];

  if (phase !== row.phase) history.push(entry("PHASE", row.phase, phase));
  if (verdict.plan !== row.plan || verdict.cycle !== row.cycle) {
    history.push(entry("PLAN", planLabel(row.plan, row.cycle), planLabel(verdict.plan, verdict.cycle)));
  }
  if (scheduled.transition !== "UNCHANGED") {
    history.push(
      entry(
        "SCHEDULED_CHANGE",
        row.scheduledPlan && row.scheduledCycle ? planLabel(row.scheduledPlan, row.scheduledCycle) : null,
        scheduled.transition === "FLAGGED" ? "UNKNOWN_TARGET" : scheduled.transition,
      ),
    );
  }
  if (cancelFlagCleared) history.push(entry("CANCEL_AT_PERIOD_END", "true", "false"));

  await SubscriptionHistoryRepository.record(tx, history);

  // 5c. Anomalies this observation proves stale.
  for (const { type, subject } of SELF_CLEARING) {
    const subjectKey = subject(row);

    if (subjectKey && (await BillingAnomalyRepository.resolveOpen(tx, type, subjectKey, "AUTO: a later observation applied", now))) {
      effects.events.push({ event: "anomaly.resolved", fields: { ...log, type, subjectKey, by: "observation" } });
    }
  }

  // 6. Bookkeeping and the next due time.
  const phaseEnteredAt =
    phase !== row.phase ? observationAt : await SubscriptionHistoryRepository.phaseEnteredAt(tx, row.id, phase);
  const due = isTerminalPhase(phase)
    ? null
    : row.syncRequestedAt && row.syncRequestedAt.getTime() > observationAt.getTime()
      ? { at: now, reason: row.syncReason ?? "WEBHOOK" }
      : nextDue(
          {
            phase,
            now,
            phaseEnteredAt,
            expireBy: state.expireBy,
            startAt: state.startAt,
            chargeAt: state.chargeAt,
            currentPeriodEnd: state.currentEnd,
            scheduledChangeAt: scheduled.next.scheduledChangeAt,
          },
          schedule,
        );

  await tx.subscription.update({
    where: { id: row.id },
    data: {
      phase,
      plan: verdict.plan,
      cycle: verdict.cycle,
      providerPlanId: state.providerPlanId,
      providerStatus: state.rawStatus,
      providerSnapshot: snapshotOf(state),
      currentPeriodStart: state.currentStart,
      currentPeriodEnd: state.currentEnd,
      chargeAt: state.chargeAt,
      startAt: state.startAt,
      expireBy: state.expireBy,
      endedAt: state.endedAt,
      offerId: state.offerId,
      ...scheduled.next,
      ...(cancelFlagCleared && { cancelAtPeriodEnd: false }),
      ...(isContributingPhase(phase) && row.firstContributedAt === null && { firstContributedAt: now }),
      ...(recoveredFromHalt && { advisoryPaymentMethod: null, advisoryInternationalCard: null }),
      ...(state.paymentMethod !== null && { advisoryPaymentMethod: state.paymentMethod }),
      lastAppliedObservationAt: observationAt,
      lastSyncedAt: now,
      syncAttempts: 0,
      lastSyncFailureClass: null,
      syncLeaseUntil: null,
      syncDueAt: due?.at ?? null,
      ...(due && { syncReason: due.reason }),
    },
  });

  // 7. More than one open subscription for the user in this mode.
  if (phase !== row.phase && row.userId !== null) {
    await checkOpenSubscriptions(tx, row.userId, row.providerMode, now, effects);
  }

  if (mapped.trialConversionOverdue) {
    // The anomaly row arrives with its enum value in Phase VII; the alert is emitted now (IB-24 item 8).
    effects.alerts.push({ condition: BillingAlertCondition.TRIAL_CONVERSION_OVERDUE, severity: "MEDIUM", fields: log });
  }

  const changed = history.length > 0;

  effects.events.push({
    event: changed ? "sync.applied" : "sync.no_change",
    fields: { ...log, from: row.phase, to: phase, observationAt, nextDueAt: due?.at ?? null, operationId: settledOperationId },
  });

  if (phase !== row.phase && !isUsualTransition(row.phase, phase)) {
    effects.events.push({ event: "sync.unusual_transition", fields: { ...log, from: row.phase, to: phase } });
  }

  return { outcome: "APPLIED", previousPhase: row.phase, phase, changed, nextDueAt: due?.at ?? null };
}

// ---------------------------------------------------------------------------

const ANOMALY_FOR: Readonly<Record<ApplyRejection, BillingAnomalyType | null>> = {
  MODE_MISMATCH: "PROVIDER_MODE_MISMATCH",
  NOTES_CONFLICT: "NOTES_CONFLICT",
  UNMAPPED_PLAN: "UNMAPPED_PROVIDER_PLAN",
  TERMINAL_STATE_CONTRADICTED: "TERMINAL_STATE_CONTRADICTED",
  // MALFORMED is alert-only, never an anomaly row (IB-17(d)).
  UNKNOWN_STATUS: null,
};

const FAILURE_CLASS_FOR: Readonly<Record<ApplyRejection, ProviderFailureClass>> = {
  MODE_MISMATCH: "MALFORMED",
  NOTES_CONFLICT: "MALFORMED",
  UNKNOWN_STATUS: "MALFORMED",
  UNMAPPED_PLAN: "UNMAPPED_PLAN",
  TERMINAL_STATE_CONTRADICTED: "MALFORMED",
};

/** An observation that cannot be applied: nothing about phase, plan or access changes. */
async function reject(
  tx: Prisma.TransactionClient,
  row: Subscription,
  rejection: ApplyRejection,
  detail: Readonly<Record<string, string>>,
  now: Date,
  context: ApplyContext,
  effects: Effects,
  log: Record<string, unknown>,
): Promise<ApplyResult> {
  const failureClass = FAILURE_CLASS_FOR[rejection];
  const failure = await recordSyncFailure(tx, row, failureClass, now, context.random);
  const anomalyType = ANOMALY_FOR[rejection];

  effects.events.push({
    event: "sync.failed",
    fields: { ...log, failureClass, rejection, attempts: failure.attempts, nextDueAt: failure.nextDueAt },
  });

  if (anomalyType === null) {
    effects.alerts.push({ condition: BillingAlertCondition.MALFORMED, severity: "HIGH", fields: { ...log, ...detail } });

    return { outcome: "REJECTED", rejection, failureClass };
  }

  const input: AnomalyInput = {
    type: anomalyType,
    providerMode: row.providerMode,
    subjectKey: AnomalySubject.subscription(row.id),
    userId: row.userId,
    subscriptionIds: [row.id],
    providerSubscriptionId: row.providerSubscriptionId,
    details: { ...detail },
  };

  await raiseAnomaly(tx, input, now, effects, log);

  return { outcome: "REJECTED", rejection, failureClass };
}

async function checkOpenSubscriptions(
  tx: Prisma.TransactionClient,
  userId: string,
  mode: ProviderMode,
  now: Date,
  effects: Effects,
): Promise<void> {
  const open = await tx.subscription.findMany({
    where: { userId, providerMode: mode, phase: { notIn: ["CANCELLED", "EXPIRED", "COMPLETED", "ABANDONED"] } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  if (open.length <= 1) return;

  await raiseAnomaly(
    tx,
    {
      type: "MULTIPLE_OPEN_SUBSCRIPTIONS",
      providerMode: mode,
      subjectKey: AnomalySubject.user(userId),
      userId,
      subscriptionIds: open.map((subscription) => subscription.id),
      details: { openCount: String(open.length) },
    },
    now,
    effects,
    { userId, mode },
  );
}

/** Raises an anomaly; alerts only when this call opened it. */
export async function raiseAnomaly(
  tx: Prisma.TransactionClient,
  input: AnomalyInput,
  now: Date,
  effects: Effects,
  log: Record<string, unknown>,
): Promise<void> {
  const raised = await BillingAnomalyRepository.raise(tx, input, now);

  effects.events.push({
    event: "anomaly.raised",
    fields: { ...log, type: input.type, subjectKey: input.subjectKey, anomalyId: raised.id, occurrences: raised.occurrences },
  });

  if (raised.opened) {
    effects.alerts.push({
      condition: input.type,
      severity: "HIGH",
      fields: { ...log, anomalyId: raised.id, subjectKey: input.subjectKey },
    });
  }
}

function planLabel(plan: MembershipPlan, cycle: BillingCycle): string {
  return `${plan}/${cycle}`;
}

/** The provider state, as stored for diagnosis (billing-internal, SB-PB-04). */
function snapshotOf(state: ProviderSubscriptionState): Prisma.InputJsonObject {
  const iso = (date: Date | null) => date?.toISOString() ?? null;

  return {
    providerSubscriptionId: state.providerSubscriptionId,
    rawStatus: state.rawStatus,
    providerPlanId: state.providerPlanId,
    currentStart: iso(state.currentStart),
    currentEnd: iso(state.currentEnd),
    chargeAt: iso(state.chargeAt),
    startAt: iso(state.startAt),
    endAt: iso(state.endAt),
    endedAt: iso(state.endedAt),
    expireBy: iso(state.expireBy),
    hasScheduledChanges: state.hasScheduledChanges,
    changeScheduledAt: iso(state.changeScheduledAt),
    offerId: state.offerId,
    notes: { ...state.notes },
    paidCount: state.paidCount,
    paymentMethod: state.paymentMethod,
    haltedAt: iso(state.haltedAt),
  };
}

/** The transitions lifecycle/state-mapping.md expects. Anything else is applied, and logged as unusual. */
const USUAL: Readonly<Partial<Record<SubscriptionPhase, readonly SubscriptionPhase[]>>> = {
  PROVISIONING: ["PENDING_AUTHENTICATION", "ABANDONED"],
  PENDING_AUTHENTICATION: ["TRIALING", "ACTIVE", "EXPIRED", "CANCELLED"],
  TRIALING: ["ACTIVE", "PAST_DUE", "CANCELLED", "PENDING_AUTHENTICATION"],
  ACTIVE: ["PAST_DUE", "CANCELLED", "PAUSED", "COMPLETED"],
  PAST_DUE: ["ACTIVE", "HALTED", "CANCELLED"],
  HALTED: ["ACTIVE", "CANCELLED"],
  PAUSED: ["ACTIVE", "CANCELLED"],
};

function isUsualTransition(from: SubscriptionPhase, to: SubscriptionPhase): boolean {
  return USUAL[from]?.includes(to) ?? false;
}
