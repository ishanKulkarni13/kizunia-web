/**
 * Billing — Offer Catalog
 *
 * Maps a marketing code to a pre-provisioned Razorpay Offer, per provider mode
 * (SB-CP-01…05, docs/architecture/subscription/entitlements/coupons-and-offers.md).
 * Razorpay Offers can only be created in the Dashboard, so their IDs are
 * configuration, the same as plan IDs, and test and live Offers are different
 * objects, so each mode has its own list.
 *
 * **V1 provisioning, an intentional limitation (IB-27 item 6).** The flow is:
 *
 *   Razorpay Dashboard  ->  offer_id  ->  an entry below  ->  deploy  ->  the code works
 *
 * Adding an Offer is a code-reviewed change and a deployment. This file is an
 * infrastructure concern, not the definition of the promotion domain: the
 * eligibility rules, the checkout command and the redemption logic never read
 * it. They ask `OfferCodeSource` (`backend/offers/offer-code-source.ts`), a
 * narrow asynchronous port, so a later admin-managed catalog (an admin copies
 * the Razorpay `offer_id` and its metadata into Kizunia, stored in the
 * database, no deploy) replaces the source and nothing else.
 *
 * What an entry carries is Kizunia's side of the commercial terms:
 *
 *   marketingCode   what a customer types (matched after `normalizeCode`)
 *   providerOfferId the Razorpay Offer (never leaves the billing module)
 *   appliesTo       the plans and cycles the code may be used for
 *   eligibility    one rule of SB-CP-04, checked against the user's own history
 *   validFrom/Until the window the code can be used in (Kizunia-side)
 *   description     the text the customer sees once the code applies
 *
 * The discount itself (flat or percentage, for how many cycles, its own dates
 * and usage limits) is the Offer's own configuration at Razorpay. Kizunia does
 * not compute it, so the description is text, never an amount.
 *
 * Both lists ship EMPTY. An empty list is a safe state: every code is refused
 * as unknown, before any provider call. The first entries are added when an
 * Offer exists in the matching Razorpay account (the Phase VII runbook).
 *
 * The invariants are checked when this module loads, so a bad entry fails the
 * first test run.
 */
import type {
  BillingCycle,
  CodeEligibility,
  MembershipPlan,
  ProviderMode,
} from "@/generated/prisma";

import { normalizeCode } from "../policy/code-eligibility";

export interface OfferCatalogEntry {
  /** What a customer types or a link carries. Matched after `normalizeCode`. */
  readonly marketingCode: string;
  /** The Razorpay Offer ID, e.g. `offer_Abc123`. */
  readonly providerOfferId: string;
  readonly appliesTo: readonly {
    readonly plan: MembershipPlan;
    readonly cycle: BillingCycle;
  }[];
  readonly eligibility: CodeEligibility;
  readonly validFrom?: Date;
  readonly validUntil?: Date;
  readonly description: string;
}

export interface OfferCatalog {
  /** The entry for a code (matched case-insensitively, trimmed), or `undefined`. */
  findByCode(code: string): OfferCatalogEntry | undefined;
  /** Every normalized code in the catalog. */
  codes(): readonly string[];
}

/**
 * Builds a catalog, refusing an inconsistent list:
 *  - a code is unique after normalization, and non-empty;
 *  - a Razorpay Offer ID is unique;
 *  - an entry applies to at least one plan and cycle;
 *  - a window ends after it starts.
 */
export function createOfferCatalog(
  entries: readonly OfferCatalogEntry[],
): OfferCatalog {
  const byCode = new Map<string, OfferCatalogEntry>();
  const offerIds = new Set<string>();

  for (const entry of entries) {
    const code = normalizeCode(entry.marketingCode);

    if (code.length === 0)
      throw new Error("An offer catalog entry has an empty marketing code.");
    if (byCode.has(code))
      throw new Error(
        `Offer catalog: the marketing code ${code} appears twice.`,
      );
    if (entry.providerOfferId.trim().length === 0)
      throw new Error(`Offer catalog: ${code} has no Razorpay Offer ID.`);
    if (offerIds.has(entry.providerOfferId))
      throw new Error(
        `Offer catalog: the Offer ID ${entry.providerOfferId} appears twice.`,
      );
    if (entry.appliesTo.length === 0)
      throw new Error(`Offer catalog: ${code} applies to no plan.`);
    if (
      entry.validFrom &&
      entry.validUntil &&
      entry.validUntil.getTime() <= entry.validFrom.getTime()
    ) {
      throw new Error(
        `Offer catalog: the window of ${code} ends before it starts.`,
      );
    }

    offerIds.add(entry.providerOfferId);
    byCode.set(code, entry);
  }

  return {
    findByCode: (code) => byCode.get(normalizeCode(code)),
    codes: () => [...byCode.keys()],
  };
}

const CATALOGS: Readonly<Record<ProviderMode, OfferCatalog>> = {
  TEST: createOfferCatalog([
    {
      marketingCode: "WELCOME50",
      providerOfferId: "offer_TgYJ4Sg8hJpJgN",
      appliesTo: [{ plan: "PRO", cycle: "MONTHLY" }],
      eligibility: "ONCE_PER_USER",
      description: "50% off your first month",
    },
  ]),
  LIVE: createOfferCatalog([]),
};

export function getOfferCatalog(mode: ProviderMode): OfferCatalog {
  return CATALOGS[mode];
}

/** Whether a code exists in any mode's catalog: promotion codes must stay disjoint from Offer codes (SB-CP-01). */
export function offerCodeExistsInAnyMode(code: string): boolean {
  return Object.values(CATALOGS).some(
    (catalog) => catalog.findByCode(code) !== undefined,
  );
}
