/**
 * Billing — What a Checkout Acquires: a Trial and/or an Offer Code
 *
 * The one place a checkout request's trial flag and marketing code are turned
 * into what the rest of the checkout machinery uses (Phase VII; IB-27). It is
 * the seam between three separate concerns, and keeps them separate:
 *
 *   commercial rules   `policy/code-eligibility.ts`, `policy/trial-eligibility.ts`
 *                      (pure; decide from the facts below, never read a store)
 *   code definitions   `OfferCodeSource` (a static catalog today; the provider's
 *                      Offer is an opaque reference nothing here interprets)
 *   the subscription   `createProvisioning` records the decision on the
 *                      PROVISIONING row; the create step later sends exactly that
 *
 * This file does no provider work and decides nothing itself: it gathers the
 * facts in the caller's transaction (the user's own Subscription history, the
 * code's definition), and it computes the one thing only it knows at write
 * time, a trial's first-charge time, so it is written once and sent unchanged.
 *
 * The client's price, discount, plan eligibility, trial eligibility and
 * provider identifiers are never inputs: the request carries at most a trial
 * flag and a code, and everything else is resolved here from Kizunia's records.
 */
import type { Prisma, PrismaClient, ProviderMode, SubscriptionKind } from "@/generated/prisma";

import { CHECKOUT_CONFIG } from "../../config/billing-config";
import { NO_BILLING_HISTORY, normalizeCode } from "../../policy/code-eligibility";
import type { CheckoutAcquisition, CheckoutDecision } from "../../policy/command-preconditions";
import { getOfferCodeSource, type OfferCodeSource } from "../offers/offer-code-source";
import { loadBillingHistory } from "./billing-history";
import type { ProvisioningAcquisition } from "./provisioning";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AcquisitionDeps {
  readonly offers?: OfferCodeSource;
  /** Overrides the trial length: a TEST verification uses a short trial. Production reads `BILLING_TRIAL_LENGTH_DAYS`. */
  readonly trialLengthSeconds?: number;
}

export interface AcquisitionRequest {
  readonly trial?: boolean;
  readonly code?: string;
}

export class Acquisition {
  readonly kind: SubscriptionKind;
  /** The normalized code the customer entered, or `null`. */
  readonly code: string | null;

  private readonly offers: OfferCodeSource;
  private readonly trialLengthMs: number;

  constructor(request: AcquisitionRequest, deps: AcquisitionDeps = {}) {
    this.kind = request.trial === true ? "TRIAL" : "STANDARD";
    this.code = request.code === undefined ? null : normalizeCode(request.code);
    this.offers = deps.offers ?? getOfferCodeSource();
    this.trialLengthMs = deps.trialLengthSeconds === undefined ? CHECKOUT_CONFIG.trialLengthDays * DAY_MS : deps.trialLengthSeconds * 1000;
  }

  /** Rebuilds the acquisition a recorded operation was created with (a replay explains itself from its own stored request). */
  static fromStored(stored: { readonly kind: SubscriptionKind; readonly code?: string | undefined }, deps: AcquisitionDeps = {}): Acquisition {
    return new Acquisition({ trial: stored.kind === "TRIAL", code: stored.code }, deps);
  }

  /** The fields the operation's stored `request` carries, beside the plan and cycle. */
  get requestFields(): { readonly kind: SubscriptionKind; readonly code?: string } {
    return this.code === null ? { kind: this.kind } : { kind: this.kind, code: this.code };
  }

  /**
   * The facts the acquisition rules decide from, read in the caller's
   * transaction (it holds the user's slot). The history is read only when a
   * trial or a code needs it.
   */
  async policyInput(db: Prisma.TransactionClient | PrismaClient, userId: string, mode: ProviderMode): Promise<CheckoutAcquisition> {
    const needsHistory = this.kind === "TRIAL" || this.code !== null;
    const history = needsHistory ? await loadBillingHistory(db, userId, mode) : NO_BILLING_HISTORY;
    const offer = this.code === null ? null : await this.offers.findByCode(mode, this.code);

    return { kind: this.kind, code: this.code, offer, history };
  }

  /** What the `PROVISIONING` record stores for a `CREATE` decision. */
  provisioningFor(decision: Extract<CheckoutDecision, { kind: "CREATE" }>, now: Date): ProvisioningAcquisition {
    return {
      kind: this.kind,
      // Only a trial has a future start; a STANDARD subscription never does.
      startAt: this.kind === "TRIAL" ? new Date(now.getTime() + this.trialLengthMs) : null,
      offerId: decision.offer?.offerRef ?? null,
      marketingCode: decision.offer?.code ?? null,
    };
  }
}
