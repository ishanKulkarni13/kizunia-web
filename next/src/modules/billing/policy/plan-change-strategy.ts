/**
 * Billing — The Plan-Change Strategy
 *
 * **The one place** that decides how a paid→paid plan change is carried out
 * (IB-21 item 1; docs/architecture/subscription/lifecycle/upgrade-downgrade.md).
 * `ChangePlan` asks this policy and does what it says; neither the runner, the
 * controller nor the UI ever branches on the payment method themselves.
 *
 *   direction (by price, IB-26 item 6)   upgrade: target costs more  -> `now`
 *                                        downgrade: target costs less -> `cycle_end`
 *                                        a price missing              -> UNAVAILABLE (PRICE_UNKNOWN)
 *                                        the same price               -> UNAVAILABLE (SAME_PRICE)
 *   phase (Razorpay updates only authenticated/active, SB-LC-07)
 *                                        upgrade:   ACTIVE or TRIALING
 *                                        downgrade: ACTIVE only (SB-LC-03)
 *                                        otherwise  -> UNAVAILABLE (SUBSCRIPTION_STATE)
 *   advisory payment method (UX only)    UPI, e-mandate, domestic card, or corrected
 *                                        by an earlier refusal -> UNAVAILABLE (PAYMENT_METHOD)
 *                                        international card, or unknown -> NATIVE_UPDATE
 *
 * With an unknown method the update is sent: Razorpay's answer is the
 * authoritative check (SB-LC-07), and a refusal corrects the advisory
 * (IB-26 item 7). V1 has two strategies. A later switch/successor flow for the
 * methods Razorpay cannot update is one more branch here (`SWITCH`) with its
 * own child operations; nothing else changes.
 *
 * Pure.
 */
import type { SubscriptionPhase } from "@/generated/prisma";

/** The advisory payment-method fields of a subscription (UX only, SB-LC-07). */
export interface PaymentMethodAdvisory {
  readonly advisoryPaymentMethod: string | null;
  readonly advisoryInternationalCard: boolean | null;
}

/**
 * Advisory only (SB-LC-07): whether Razorpay is expected to allow a native
 * plan change. Razorpay refuses Update for UPI, e-mandate and domestic-card
 * subscriptions (R-06), so only an international card is expected to work.
 * `advisoryInternationalCard === false` is also how a refused update corrects
 * the advisory (IB-26 item 7), whatever the method. Razorpay decides; this
 * only shapes what the UI offers.
 */
export type PlanChangeAdvisory = "NATIVE_UPDATE_POSSIBLE" | "V1_LIMITATION" | "UNKNOWN";

export function planChangeAdvisory(subscription: PaymentMethodAdvisory): PlanChangeAdvisory {
  if (subscription.advisoryInternationalCard === false) return "V1_LIMITATION";

  const method = subscription.advisoryPaymentMethod?.toLowerCase() ?? null;

  if (method === null) return "UNKNOWN";
  if (method === "card") return subscription.advisoryInternationalCard === true ? "NATIVE_UPDATE_POSSIBLE" : "UNKNOWN";

  return "V1_LIMITATION";
}

export type PlanChangeDirection = "UPGRADE" | "DOWNGRADE";

/** When Razorpay should apply a native update. */
export type ScheduleChangeAt = "NOW" | "CYCLE_END";

export type PlanChangeUnavailableReason =
  /** Razorpay cannot update this subscription's payment method (V1 limitation, SB-LC-07). */
  | "PAYMENT_METHOD"
  /** The subscription is not in a phase Razorpay updates. */
  | "SUBSCRIPTION_STATE"
  /** A price is not configured, so upgrade and downgrade cannot be told apart. */
  | "PRICE_UNKNOWN"
  /** The target costs the same as the current plan: neither an upgrade nor a downgrade. */
  | "SAME_PRICE";

export type PlanChangeStrategy =
  | { readonly kind: "NATIVE_UPDATE"; readonly direction: PlanChangeDirection; readonly scheduleChangeAt: ScheduleChangeAt }
  | { readonly kind: "UNAVAILABLE"; readonly reason: PlanChangeUnavailableReason };

export interface PlanChangeStrategyInput {
  readonly phase: SubscriptionPhase;
  readonly advisory: PaymentMethodAdvisory;
  /** The price of the plan the subscription is on (minor units), if configured. */
  readonly currentPriceMinor: number | undefined;
  /** The price of the plan the customer asked for (minor units), if configured. */
  readonly targetPriceMinor: number | undefined;
}

/** Upgrade or downgrade, by price (SB-LC-02/03); `null` when it cannot be decided. */
export function planChangeDirection(
  currentPriceMinor: number | undefined,
  targetPriceMinor: number | undefined,
): PlanChangeDirection | "SAME_PRICE" | null {
  if (currentPriceMinor === undefined || targetPriceMinor === undefined) return null;
  if (targetPriceMinor === currentPriceMinor) return "SAME_PRICE";

  return targetPriceMinor > currentPriceMinor ? "UPGRADE" : "DOWNGRADE";
}

export function planChangeStrategy(input: PlanChangeStrategyInput): PlanChangeStrategy {
  const direction = planChangeDirection(input.currentPriceMinor, input.targetPriceMinor);

  if (direction === null) return { kind: "UNAVAILABLE", reason: "PRICE_UNKNOWN" };
  if (direction === "SAME_PRICE") return { kind: "UNAVAILABLE", reason: "SAME_PRICE" };

  const phaseAllows = direction === "UPGRADE" ? input.phase === "ACTIVE" || input.phase === "TRIALING" : input.phase === "ACTIVE";

  if (!phaseAllows) return { kind: "UNAVAILABLE", reason: "SUBSCRIPTION_STATE" };

  if (planChangeAdvisory(input.advisory) === "V1_LIMITATION") return { kind: "UNAVAILABLE", reason: "PAYMENT_METHOD" };

  return { kind: "NATIVE_UPDATE", direction, scheduleChangeAt: direction === "UPGRADE" ? "NOW" : "CYCLE_END" };
}
