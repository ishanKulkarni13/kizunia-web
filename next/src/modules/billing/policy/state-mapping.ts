/**
 * Billing — State Mapping
 *
 * The one place a Razorpay subscription status becomes a Kizunia
 * `SubscriptionPhase` (docs/architecture/subscription/lifecycle/state-mapping.md).
 * The sync apply path is its only caller; nothing else reads a provider status.
 *
 * Three layers are kept apart: the provider's status (a string, billing-
 * internal), the Kizunia phase (below), and whether that phase contributes
 * access (`lib/entitlements`, which reads only the phase).
 *
 *   created                                          -> PENDING_AUTHENTICATION
 *   authenticated, TRIAL, start_at in the future     -> TRIALING
 *   authenticated, TRIAL, start_at passed, < grace   -> TRIALING  (conversion pending, IB-9)
 *   authenticated, otherwise                         -> PENDING_AUTHENTICATION
 *                                                       (a TRIAL past start_at + grace is
 *                                                        flagged `trialConversionOverdue`)
 *   active -> ACTIVE     pending -> PAST_DUE     halted -> HALTED     paused -> PAUSED
 *   cancelled -> CANCELLED   expired -> EXPIRED   completed -> COMPLETED
 *   anything else                                    -> not applied (MALFORMED)
 *
 * `TRIALING` needs `kind`, never just a future `start_at`: Razorpay has no trial
 * object, and a Dashboard-created future-start subscription looks identical.
 * Only a subscription Kizunia created as `TRIAL` can be trialing (SB-LC-10).
 *
 * Pure: the clock is an argument.
 */
import type { SubscriptionKind, SubscriptionPhase } from "@/generated/prisma";
import { CONTRIBUTING_PHASES } from "@/lib/entitlements/subscription-contribution";

/** Phases a subscription never leaves. A terminal row is never synced again. */
export const TERMINAL_PHASES: readonly SubscriptionPhase[] = [
  "CANCELLED",
  "EXPIRED",
  "COMPLETED",
  "ABANDONED",
];

export function isTerminalPhase(phase: SubscriptionPhase): boolean {
  return TERMINAL_PHASES.includes(phase);
}

/** Open = not terminal. Used for the multiple-open-subscriptions check. */
export function isOpenPhase(phase: SubscriptionPhase): boolean {
  return !isTerminalPhase(phase);
}

export function isContributingPhase(phase: SubscriptionPhase): boolean {
  return CONTRIBUTING_PHASES.includes(phase);
}

/** The provider statuses Kizunia knows. Anything else is a malformed observation. */
export const KNOWN_PROVIDER_STATUSES = [
  "created",
  "authenticated",
  "active",
  "pending",
  "halted",
  "paused",
  "cancelled",
  "completed",
  "expired",
] as const;

export interface PhaseMappingInput {
  readonly rawStatus: string;
  readonly kind: SubscriptionKind;
  /** The provider's `start_at`: a trial's first charge. */
  readonly startAt: Date | null;
  readonly now: Date;
  /** C7: how long a trial may stay `authenticated` past `start_at` and still count (IB-9). */
  readonly trialConversionGraceSeconds: number;
}

export type PhaseMapping =
  | {
      readonly applied: true;
      readonly phase: SubscriptionPhase;
      /**
       * A `TRIAL` still `authenticated` past `start_at` + C7. It no longer
       * contributes; the caller raises the alert (and, from Phase VII, the
       * `TRIAL_CONVERSION_OVERDUE` anomaly).
       */
      readonly trialConversionOverdue: boolean;
    }
  | { readonly applied: false; readonly reason: "UNKNOWN_STATUS" };

const DIRECT: ReadonlyMap<string, SubscriptionPhase> = new Map([
  ["created", "PENDING_AUTHENTICATION"],
  ["active", "ACTIVE"],
  ["pending", "PAST_DUE"],
  ["halted", "HALTED"],
  ["paused", "PAUSED"],
  ["cancelled", "CANCELLED"],
  ["expired", "EXPIRED"],
  ["completed", "COMPLETED"],
]);

export function mapPhase(input: PhaseMappingInput): PhaseMapping {
  const { rawStatus } = input;

  if (rawStatus === "authenticated") return mapAuthenticated(input);

  const phase = DIRECT.get(rawStatus);

  if (phase === undefined) return { applied: false, reason: "UNKNOWN_STATUS" };

  return { applied: true, phase, trialConversionOverdue: false };
}

function mapAuthenticated({ kind, startAt, now, trialConversionGraceSeconds }: PhaseMappingInput): PhaseMapping {
  // A STANDARD subscription is authenticated only on its way to active; a trial
  // with no start_at has nothing that makes it a trial. Neither contributes.
  if (kind !== "TRIAL" || startAt === null) {
    return { applied: true, phase: "PENDING_AUTHENTICATION", trialConversionOverdue: false };
  }

  const graceEnds = startAt.getTime() + trialConversionGraceSeconds * 1000;

  if (now.getTime() < graceEnds) {
    return { applied: true, phase: "TRIALING", trialConversionOverdue: false };
  }

  return { applied: true, phase: "PENDING_AUTHENTICATION", trialConversionOverdue: true };
}
