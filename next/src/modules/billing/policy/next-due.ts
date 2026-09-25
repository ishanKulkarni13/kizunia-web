/**
 * Billing — When a Subscription Is Next Observed
 *
 * Reconciliation is due-based, never a sweep (SB-RC-05). After every successful
 * sync, the apply path asks this function when that subscription next needs an
 * authoritative fetch, from the state it just applied:
 *
 *   nextDue = min(earliest upcoming checkpoint + margin, now + heartbeat(phase, timeInPhase))
 *
 *   PENDING_AUTHENTICATION   expire_by (+ the expiry-lag margin)        heartbeat: hours
 *   TRIALING                 start_at, and start_at + C7 (IB-9)         heartbeat: days
 *   ACTIVE                   charge_at, current_end, scheduled change   heartbeat: ~weekly
 *   PAST_DUE                 charge_at (the next retry)                 heartbeat: daily
 *   HALTED                   —                                          decaying: daily → weekly → monthly (SB-PF-05)
 *   PAUSED                   —                                          heartbeat: weekly
 *   PROVISIONING, terminal   never (PROVISIONING is resolved by orphan discovery)
 *
 * A checkpoint is where a missed webhook would have mattered (a renewal, a cycle
 * end, a trial's first charge), so observing just after it catches the change
 * within a margin. The margin exists because Razorpay's renewal and its webhook
 * take time; observing a little after the checkpoint finds the settled state
 * instead of racing it. `expire_by` has its own, shorter margin: TEST observed
 * the move to `expired` 188–322 s late (D6).
 *
 * A checkpoint counts while `checkpoint + margin` is still ahead. One already
 * behind has either been observed or never will be by waiting; the heartbeat
 * covers it.
 *
 * `currentPeriodEnd` is always an `ACTIVE` checkpoint, so a requested cycle-end
 * cancellation (`cancelAtPeriodEnd`) is observed when it should take effect
 * without needing a separate rule.
 *
 * Pure: the clock is an argument.
 */
import type { SubscriptionPhase } from "@/generated/prisma";

export interface HeartbeatSettings {
  readonly pendingAuthenticationSeconds: number;
  readonly trialingSeconds: number;
  readonly activeSeconds: number;
  readonly pastDueSeconds: number;
  readonly pausedSeconds: number;
  /** `HALTED` decays: this for its first week, then weekly, then monthly after a month. */
  readonly haltedFirstWeekSeconds: number;
  readonly haltedFirstMonthSeconds: number;
  readonly haltedAfterMonthSeconds: number;
}

export interface NextDueSettings {
  readonly checkpointMarginSeconds: number;
  readonly expireByMarginSeconds: number;
  readonly trialConversionGraceSeconds: number;
  readonly heartbeats: HeartbeatSettings;
}

export interface NextDueInput {
  readonly phase: SubscriptionPhase;
  readonly now: Date;
  /** When the subscription entered its current phase, for `HALTED` decay. `null` = unknown (treated as now). */
  readonly phaseEnteredAt: Date | null;
  readonly expireBy: Date | null;
  readonly startAt: Date | null;
  readonly chargeAt: Date | null;
  readonly currentPeriodEnd: Date | null;
  readonly scheduledChangeAt: Date | null;
}

export type NextDueReason = "CHECKPOINT" | "HEARTBEAT";

export type NextDue = { readonly at: Date; readonly reason: NextDueReason } | null;

const DAY_SECONDS = 24 * 60 * 60;

/** The next time this subscription needs a fetch, or `null` if it never does. */
export function nextDue(input: NextDueInput, settings: NextDueSettings): NextDue {
  const heartbeatSeconds = heartbeatFor(input, settings.heartbeats);

  if (heartbeatSeconds === null) return null;

  const heartbeat = new Date(input.now.getTime() + heartbeatSeconds * 1000);
  const checkpoint = earliestCheckpoint(checkpointsFor(input, settings), input.now);

  if (checkpoint !== null && checkpoint.getTime() <= heartbeat.getTime()) {
    return { at: checkpoint, reason: "CHECKPOINT" };
  }

  return { at: heartbeat, reason: "HEARTBEAT" };
}

interface Checkpoint {
  readonly at: Date | null;
  readonly marginSeconds: number;
}

function checkpointsFor(input: NextDueInput, settings: NextDueSettings): readonly Checkpoint[] {
  const margin = settings.checkpointMarginSeconds;

  switch (input.phase) {
    case "PENDING_AUTHENTICATION":
      return [{ at: input.expireBy, marginSeconds: settings.expireByMarginSeconds }];
    case "TRIALING":
      return [
        { at: input.startAt, marginSeconds: margin },
        {
          at: input.startAt && new Date(input.startAt.getTime() + settings.trialConversionGraceSeconds * 1000),
          marginSeconds: margin,
        },
      ];
    case "ACTIVE":
      return [
        { at: input.chargeAt, marginSeconds: margin },
        { at: input.currentPeriodEnd, marginSeconds: margin },
        { at: input.scheduledChangeAt, marginSeconds: margin },
      ];
    case "PAST_DUE":
      return [{ at: input.chargeAt, marginSeconds: margin }];
    default:
      return [];
  }
}

function earliestCheckpoint(checkpoints: readonly Checkpoint[], now: Date): Date | null {
  let earliest: number | null = null;

  for (const { at, marginSeconds } of checkpoints) {
    if (at === null) continue;

    const due = at.getTime() + marginSeconds * 1000;

    // Behind us: observed already, or the heartbeat will cover it.
    if (due <= now.getTime()) continue;

    earliest = earliest === null ? due : Math.min(earliest, due);
  }

  return earliest === null ? null : new Date(earliest);
}

function heartbeatFor(input: NextDueInput, heartbeats: HeartbeatSettings): number | null {
  switch (input.phase) {
    case "PENDING_AUTHENTICATION":
      return heartbeats.pendingAuthenticationSeconds;
    case "TRIALING":
      return heartbeats.trialingSeconds;
    case "ACTIVE":
      return heartbeats.activeSeconds;
    case "PAST_DUE":
      return heartbeats.pastDueSeconds;
    case "PAUSED":
      return heartbeats.pausedSeconds;
    case "HALTED": {
      const enteredAt = input.phaseEnteredAt ?? input.now;
      const secondsInPhase = Math.max(0, (input.now.getTime() - enteredAt.getTime()) / 1000);

      if (secondsInPhase < 7 * DAY_SECONDS) return heartbeats.haltedFirstWeekSeconds;
      if (secondsInPhase < 30 * DAY_SECONDS) return heartbeats.haltedFirstMonthSeconds;

      return heartbeats.haltedAfterMonthSeconds;
    }
    // PROVISIONING has no provider ID to fetch; terminal phases are never synced.
    default:
      return null;
  }
}
