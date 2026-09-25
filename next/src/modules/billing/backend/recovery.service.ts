/**
 * Billing — Recovery Entry Points (HALTED, PAUSED)
 *
 * A subscription on hold can come back without a new purchase
 * (docs/architecture/subscription/lifecycle/payment-failure-and-recovery.md):
 * the customer changes the payment method in Razorpay's own flow and a charge
 * succeeds. Kizunia only opens that flow and then observes the result; it
 * never collects payment details and never resumes anything itself.
 *
 *   recovery   `checkout.js` with `subscription_card_change`, for the caller's own
 *              HALTED or PAUSED subscription: `keyId` and the provider subscription
 *              ID, to the owner only (IB-26 item 8). No provider call, no operation
 *   check now  a read-only targeted sync of the caller's own open subscription at
 *              priority 2, like checkout confirmation (no operation, no key). The
 *              phase moves only through the apply path
 *
 * Which of recovery and supersession a UPI subscriber is offered, and in what
 * order, is PROVIDER-DEPENDENT (IB-22): the UI offers recovery first for every
 * method until UPI is verified.
 */
import type { StrictAuthorizationActor } from "@/authorization";
import prisma from "@/lib/prisma";

import type { PlanCatalog } from "../config/plan-catalog";
import { BillingUnavailableError, NoSubscriptionError, NotRecoverableError } from "../errors";
import { logBillingEvent } from "../observability/log";
import { isSupersedable } from "../policy/command-preconditions";
import { getBillingProvider } from "../provider/provider-factory";
import {
  assertBillingProviderEnabled,
  getCheckoutKeyId,
  getProviderMode,
  type ResolvedProviderMode,
} from "../provider/provider-mode";
import { ProviderPriority, type BillingProvider } from "../provider/types";
import { BillingSummaryService, type BillingSummaryDTO } from "./billing-summary.service";
import { loadOpenSubscriptions } from "./commands/provisioning";
import { SyncClaimRepository } from "./sync/claim.repository";
import { SyncService, type SyncOutcome } from "./sync/sync.service";

/** What `checkout.js` needs to open Razorpay's payment-method change. Returned only to the owner. */
export interface RecoveryParams {
  readonly keyId: string;
  readonly subscriptionId: string;
}

export interface CheckNowResult extends BillingSummaryDTO {
  /** What the sync did (APPLIED, NO_CHANGE, FAILED, LEASED…); the summary is the answer. */
  readonly syncOutcome: SyncOutcome;
}

export interface RecoveryServiceDeps {
  readonly providerFor?: (priority: ProviderPriority) => BillingProvider;
  readonly resolvedMode?: () => ResolvedProviderMode;
  readonly assertEnabled?: () => void;
  readonly keyId?: () => string | null;
  readonly now?: () => Date;
  readonly catalog?: PlanCatalog;
  readonly sync?: SyncService;
  readonly summary?: BillingSummaryService;
}

export class RecoveryService {
  private readonly resolvedMode: () => ResolvedProviderMode;
  private readonly assertEnabled: () => void;
  private readonly keyId: () => string | null;
  private readonly now: () => Date;
  private readonly sync: SyncService;
  private readonly summary: BillingSummaryService;

  constructor(deps: RecoveryServiceDeps = {}) {
    const providerFor = deps.providerFor ?? getBillingProvider;

    this.resolvedMode = deps.resolvedMode ?? getProviderMode;
    this.assertEnabled = deps.assertEnabled ?? assertBillingProviderEnabled;
    this.keyId = deps.keyId ?? getCheckoutKeyId;
    this.now = deps.now ?? (() => new Date());
    this.sync = deps.sync ?? new SyncService({ providerFor, resolvedMode: this.resolvedMode, now: this.now, catalog: deps.catalog });
    this.summary = deps.summary ?? new BillingSummaryService({ resolvedMode: this.resolvedMode, now: this.now, catalog: deps.catalog });
  }

  /** `POST /api/v1/me/billing/recovery` */
  async recoveryParams(actor: StrictAuthorizationActor): Promise<RecoveryParams> {
    const mode = this.enabledMode();
    const open = await loadOpenSubscriptions(prisma, actor.id, mode);
    const onHold = open.length === 1 && isSupersedable(open[0].phase) ? open[0] : null;

    if (!onHold?.providerSubscriptionId) throw new NotRecoverableError();

    const keyId = this.keyId();

    if (keyId === null) throw new BillingUnavailableError();

    logBillingEvent("recovery.opened", { userId: actor.id, mode, subscriptionId: onHold.id, phase: onHold.phase });

    return { keyId, subscriptionId: onHold.providerSubscriptionId };
  }

  /** `POST /api/v1/me/billing/sync` — "check now". */
  async checkNow(actor: StrictAuthorizationActor): Promise<CheckNowResult> {
    const mode = this.enabledMode();
    const open = (await loadOpenSubscriptions(prisma, actor.id, mode)).filter((row) => row.providerSubscriptionId !== null);
    const current = open.at(-1);

    if (!current) throw new NoSubscriptionError();

    const now = this.now();

    await SyncClaimRepository.markDue(prisma, current.id, "CHECKOUT_CONFIRM", now, { eventDriven: true, now });

    const result = await this.sync.syncTargeted(current.id, ProviderPriority.CONFIRMATION, { trigger: "CHECKOUT_CONFIRM" });

    logBillingEvent("recovery.checked", { userId: actor.id, mode, subscriptionId: current.id, outcome: result.outcome, phase: result.phase ?? null });

    return { ...(await this.summary.getForUser(actor)), syncOutcome: result.outcome };
  }

  private enabledMode() {
    this.assertEnabled();

    const mode = this.resolvedMode();

    if (mode === "DISABLED") throw new BillingUnavailableError();

    return mode;
  }
}
