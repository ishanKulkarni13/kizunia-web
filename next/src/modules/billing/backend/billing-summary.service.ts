/**
 * Billing — "My billing" (`GET /api/v1/me/billing`)
 *
 * Everything the billing UI renders, computed on the server, so the UI holds
 * no plan, quota or eligibility logic of its own
 * (docs/architecture/subscription/implementation/feature-integration.md):
 *
 *   plan, capabilities, quotas   the effective access (EntitlementsService, the one resolver)
 *   subscription                 the user's open subscription, as local state says (no provider call)
 *   facets                       display states layered on the phase, never phases themselves:
 *                                  finishingUp  a checkout was authenticated moments ago (confirm or webhook)
 *                                  confirming   a billing change's outcome is still being confirmed
 *                                  onHold       HALTED
 *                                  paused       PAUSED
 *                                  cancellationNotEffective  a requested cycle-end cancellation
 *                                               did not take (I-4): the customer is still subscribed
 *   allowedActions               from the same precondition policy the commands use (checkout,
 *                                cancel with its timing, plan changes, supersession, recovery)
 *
 * Read-only and cheap: this is what the UI polls while "finishing up", never
 * Razorpay. It carries no provider identifier (SB-PB-04; the subscription's
 * `id` is Kizunia's own, which a supersession request names), and in disabled
 * mode it still answers, with `billingAvailable: false`.
 */
import type { BillingCycle, MembershipPlan, ProviderMode, Subscription, SubscriptionPhase } from "@/generated/prisma";
import type { StrictAuthorizationActor } from "@/authorization";
import prisma from "@/lib/prisma";

import { CHECKOUT_CONFIG, COMMAND_CONFIG } from "../config/billing-config";
import { getPlanCatalog, type PlanCatalog } from "../config/plan-catalog";
import {
  allowedBillingActions,
  NO_BILLING_ACTIONS,
  type AllowedBillingActions,
  type CheckoutIntent,
} from "../policy/command-preconditions";
import { getProviderMode, type ResolvedProviderMode } from "../provider/provider-mode";
import { AnomalySubject } from "./anomalies/anomaly.repository";
import { BillingOperationRepository } from "./commands/operation.repository";
import { hasScheduledChange, loadOpenSubscriptions, openView, planPricesFor } from "./commands/provisioning";
import { EntitlementsService, type MyEntitlementsDTO } from "./entitlements.service";

export interface BillingSubscriptionDTO {
  /** Kizunia's ID (never the provider's): what a supersession request names. */
  readonly id: string;
  readonly phase: SubscriptionPhase;
  readonly plan: MembershipPlan;
  readonly cycle: BillingCycle;
  readonly currentPeriodEnd: string | null;
  /** Kizunia's record that a cycle-end cancellation was *requested* (never an observation, I-1). */
  readonly cancelAtPeriodEnd: boolean;
  readonly cancelRequestedAt: string | null;
  /** For a pending checkout: when it must be completed by. */
  readonly expireBy: string | null;
  /** A pending cycle-end plan change: its target when Kizunia scheduled it (null plan: set elsewhere). */
  readonly scheduledChange: {
    readonly plan: MembershipPlan | null;
    readonly cycle: BillingCycle | null;
    readonly effectiveAt: string | null;
  } | null;
}

export interface BillingSummaryDTO extends MyEntitlementsDTO {
  /** Paid billing can be used right now (a provider is configured). */
  readonly billingAvailable: boolean;
  readonly subscription: BillingSubscriptionDTO | null;
  readonly facets: {
    readonly finishingUp: boolean;
    readonly confirming: boolean;
    readonly onHold: boolean;
    readonly paused: boolean;
    readonly cancellationNotEffective: boolean;
  };
  readonly allowedActions: AllowedBillingActions;
}

export interface BillingSummaryDeps {
  readonly resolvedMode?: () => ResolvedProviderMode;
  readonly now?: () => Date;
  readonly catalog?: PlanCatalog;
}

const PLANS: readonly MembershipPlan[] = ["PRO", "PRO_PLUS"];
const CYCLES: readonly BillingCycle[] = ["MONTHLY", "YEARLY"];

/** Plans for sale in a mode: every (plan, cycle) the catalog has a current provider plan for. */
export function purchasableIntents(catalog: PlanCatalog): CheckoutIntent[] {
  return PLANS.flatMap((plan) =>
    CYCLES.flatMap((cycle) => (catalog.currentProviderPlanId(plan, cycle) ? [{ plan, cycle }] : [])),
  );
}

export class BillingSummaryService {
  private readonly resolvedMode: () => ResolvedProviderMode;
  private readonly now: () => Date;

  constructor(private readonly deps: BillingSummaryDeps = {}) {
    this.resolvedMode = deps.resolvedMode ?? getProviderMode;
    this.now = deps.now ?? (() => new Date());
  }

  async getForUser(actor: StrictAuthorizationActor): Promise<BillingSummaryDTO> {
    const entitlements = await EntitlementsService.getForUser(actor);
    const mode = this.resolvedMode();

    if (mode === "DISABLED") {
      return {
        ...entitlements,
        billingAvailable: false,
        subscription: null,
        facets: { finishingUp: false, confirming: false, onHold: false, paused: false, cancellationNotEffective: false },
        allowedActions: NO_BILLING_ACTIONS,
      };
    }

    return { ...entitlements, billingAvailable: true, ...(await this.billingState(actor.id, mode)) };
  }

  private async billingState(userId: string, mode: ProviderMode) {
    const now = this.now();
    const unknownSince = new Date(now.getTime() - COMMAND_CONFIG.outcomeUnknownResolutionSeconds * 1000);

    const [open, pendingOperations, hasOpenAnomaly] = await Promise.all([
      loadOpenSubscriptions(prisma, userId, mode),
      prisma.billingOperation.count({
        where: {
          userId,
          providerMode: mode,
          parentOperationId: null,
          OR: [{ status: "IN_FLIGHT" }, { status: "OUTCOME_UNKNOWN", createdAt: { gte: unknownSince } }],
        },
      }),
      BillingOperationRepository.hasOpenMultipleSubscriptionsAnomaly(prisma, userId, mode),
    ]);

    const current = pickCurrent(open);
    const catalog = this.deps.catalog ?? getPlanCatalog(mode);
    const notEffective = current
      ? await prisma.billingAnomaly.count({
          where: { type: "CANCELLATION_NOT_EFFECTIVE", subjectKey: AnomalySubject.subscription(current.id), resolvedAt: null },
        })
      : 0;
    const finishingUpSince = now.getTime() - CHECKOUT_CONFIG.finishingUpSeconds * 1000;
    const actions = allowedBillingActions({
      billingAvailable: true,
      open: open.map(openView),
      hasOpenAnomaly,
      now,
      reuseMinRemainingSeconds: CHECKOUT_CONFIG.reuseMinRemainingSeconds,
      purchasable: purchasableIntents(catalog),
      operationPending: pendingOperations > 0,
      prices: planPricesFor(catalog, open.length === 1 ? open[0] : undefined),
    });

    return {
      subscription: current && {
        id: current.id,
        phase: current.phase,
        plan: current.plan,
        cycle: current.cycle,
        currentPeriodEnd: current.currentPeriodEnd?.toISOString() ?? null,
        cancelAtPeriodEnd: current.cancelAtPeriodEnd,
        cancelRequestedAt: current.cancelAtPeriodEnd ? (current.cancelRequestedAt?.toISOString() ?? null) : null,
        expireBy: current.phase === "PENDING_AUTHENTICATION" ? (current.expireBy?.toISOString() ?? null) : null,
        scheduledChange: hasScheduledChange(current)
          ? {
              plan: current.scheduledPlan,
              cycle: current.scheduledCycle,
              effectiveAt: (current.scheduledChangeAt ?? current.currentPeriodEnd)?.toISOString() ?? null,
            }
          : null,
      },
      facets: {
        finishingUp: open.some(
          (row) =>
            row.phase === "PENDING_AUTHENTICATION" &&
            row.syncRequestedAt !== null &&
            row.syncRequestedAt.getTime() >= finishingUpSince,
        ),
        confirming: pendingOperations > 0 || open.some((row) => row.phase === "PROVISIONING"),
        onHold: open.some((row) => row.phase === "HALTED"),
        paused: open.some((row) => row.phase === "PAUSED"),
        cancellationNotEffective: notEffective > 0,
      },
      allowedActions: actions,
    };
  }
}

/** The subscription the UI talks about: a paying one first, then the newest open one. */
function pickCurrent(open: readonly Subscription[]): Subscription | null {
  const order: readonly SubscriptionPhase[] = ["ACTIVE", "TRIALING", "PAST_DUE", "HALTED", "PAUSED", "PENDING_AUTHENTICATION", "PROVISIONING"];

  return [...open].sort((a, b) => order.indexOf(a.phase) - order.indexOf(b.phase))[0] ?? null;
}
