/**
 * Billing — Global Cooldown Policy
 *
 * The pure state machine behind the shared provider cooldown: how each provider
 * result moves the state, with no I/O, so every transition is testable. It is
 * persisted per mode in `billing_provider_state` by the health tracker
 * (`backend/budget/provider-health.ts`).
 *
 * While the cooldown is set, priorities 2–4 do not call the provider at all
 * (priority 1 still may: a customer asking to cancel should get a real answer
 * if the provider has recovered). Without it, per-subscription backoff alone
 * still sends one request per due subscription into an outage every tick.
 *
 * | Result                                        | Effect                                        |
 * | --------------------------------------------- | --------------------------------------------- |
 * | 429                                           | enter a cooldown; level + 1                   |
 * | timeout / 5xx, `threshold` in a row           | the same                                      |
 * | timeout / 5xx, fewer                          | count it                                      |
 * | success, or a definite answer                 | clear the count; once the cooldown has ended, |
 * |                                               | clear it and let the level decay by one       |
 * | 401 / 403                                     | pin: every call refused until the key changes |
 * | malformed, or nothing sent                    | no effect                                     |
 *
 * A "definite answer" (a refusal, a not-found, a concurrent-operation reply)
 * shows the provider is up, so it counts as health, not as failure.
 *
 * A cooldown never moves EARLIER: a second 429 while one is running extends it,
 * never shortens it. Nothing here ever demotes a user or ends access: a failure
 * to observe is never an observation.
 *
 * The auth pin holds only while the configured key's fingerprint matches the
 * pinned one, so rotating the key and redeploying un-pins with no manual SQL.
 * That satisfies "until credentials are fixed and the process restarts".
 */
import type { ProviderFailureClass } from "@/generated/prisma";

import { backoffDelaySeconds, type BackoffSettings } from "./backoff";

export interface CooldownState {
  readonly cooldownUntil: Date | null;
  readonly cooldownLevel: number;
  readonly consecutiveFailures: number;
  readonly authFailurePinnedKeyFingerprint: string | null;
}

export const CLEAN_COOLDOWN_STATE: CooldownState = {
  cooldownUntil: null,
  cooldownLevel: 0,
  consecutiveFailures: 0,
  authFailurePinnedKeyFingerprint: null,
};

export interface CooldownSettings extends BackoffSettings {
  /** Consecutive timeouts or 5xx that enter a cooldown as a 429 does. */
  readonly consecutiveFailureThreshold: number;
}

export type ProviderHealthEvent =
  | { readonly kind: "HEALTHY" }
  | { readonly kind: "TRANSIENT_FAILURE" }
  | { readonly kind: "RATE_LIMITED" }
  | { readonly kind: "AUTH_FAILURE"; readonly keyFingerprint: string };

/**
 * What a provider result means for the cooldown, or `null` when it means
 * nothing (it does not say whether the provider is healthy).
 */
export function healthEventFor(
  result: ProviderFailureClass | "SUCCESS",
  keyFingerprint: string,
): ProviderHealthEvent | null {
  switch (result) {
    case "SUCCESS":
    case "REJECTED":
    case "NOT_FOUND":
    case "CONCURRENT_OPERATION":
      return { kind: "HEALTHY" };
    case "TIMEOUT":
    case "UNAVAILABLE":
      return { kind: "TRANSIENT_FAILURE" };
    case "RATE_LIMITED":
      return { kind: "RATE_LIMITED" };
    case "AUTH_FAILURE":
      return { kind: "AUTH_FAILURE", keyFingerprint };
    // A malformed body may be transient or a real change; a plan we could not
    // map, or a call refused for budget, never reached the provider.
    case "MALFORMED":
    case "UNMAPPED_PLAN":
    case "BUDGET_EXHAUSTED":
      return null;
  }
}

export function isCoolingDown(state: CooldownState, now: Date): boolean {
  return state.cooldownUntil !== null && state.cooldownUntil.getTime() > now.getTime();
}

/** Whether every call is refused because the current key already failed authentication. */
export function isAuthPinned(state: CooldownState, currentKeyFingerprint: string): boolean {
  return (
    state.authFailurePinnedKeyFingerprint !== null &&
    state.authFailurePinnedKeyFingerprint === currentKeyFingerprint
  );
}

/** A state with nothing to clear: a healthy result would change nothing. */
export function isClean(state: CooldownState): boolean {
  return (
    state.cooldownUntil === null &&
    state.cooldownLevel === 0 &&
    state.consecutiveFailures === 0 &&
    state.authFailurePinnedKeyFingerprint === null
  );
}

export interface CooldownTransition {
  readonly state: CooldownState;
  /** A cooldown was entered or extended by this event. */
  readonly entered: boolean;
  /** A cooldown that had run its course was cleared by this event. */
  readonly left: boolean;
}

export function applyHealthEvent(
  state: CooldownState,
  event: ProviderHealthEvent,
  context: {
    readonly now: Date;
    readonly settings: CooldownSettings;
    readonly random?: () => number;
  },
): CooldownTransition {
  const { now, settings, random } = context;

  const enterCooldown = (): CooldownTransition => {
    const delayMs = backoffDelaySeconds(settings, state.cooldownLevel, random) * 1000;
    const until = new Date(now.getTime() + delayMs);

    // Never move a running cooldown earlier.
    const cooldownUntil =
      state.cooldownUntil !== null && state.cooldownUntil.getTime() > until.getTime()
        ? state.cooldownUntil
        : until;

    return {
      state: {
        ...state,
        cooldownUntil,
        cooldownLevel: state.cooldownLevel + 1,
        consecutiveFailures: 0,
      },
      entered: true,
      left: false,
    };
  };

  switch (event.kind) {
    case "RATE_LIMITED":
      return enterCooldown();

    case "TRANSIENT_FAILURE": {
      const consecutiveFailures = state.consecutiveFailures + 1;

      if (consecutiveFailures >= settings.consecutiveFailureThreshold) return enterCooldown();

      return { state: { ...state, consecutiveFailures }, entered: false, left: false };
    }

    case "AUTH_FAILURE":
      return {
        state: { ...state, authFailurePinnedKeyFingerprint: event.keyFingerprint },
        entered: false,
        left: false,
      };

    case "HEALTHY": {
      // A working key clears any pin, and a definite answer ends a failure run.
      const healthy: CooldownState = {
        ...state,
        consecutiveFailures: 0,
        authFailurePinnedKeyFingerprint: null,
      };

      // A success DURING a cooldown (a priority-1 call that got through) does
      // not end it: the other priorities stay off until it has run its course.
      if (isCoolingDown(state, now)) return { state: healthy, entered: false, left: false };

      return {
        state: {
          ...healthy,
          cooldownUntil: null,
          // The level decays by one per healthy result once the cooldown is over.
          cooldownLevel: Math.max(0, state.cooldownLevel - 1),
        },
        entered: false,
        left: state.cooldownUntil !== null,
      };
    }
  }
}
