/**
 * Billing — Offer Catalog (stub)
 *
 * Maps a marketing code to a Razorpay Offer ID, per provider mode. Offers can
 * only be created in the Razorpay Dashboard, so their IDs are configuration,
 * the same as plan IDs (SB-CP-01…05, docs/architecture/subscription/
 * entitlements/coupons-and-offers.md).
 *
 * This is a stub. Nothing in Phase III applies an Offer; the lists are empty
 * and the lookup exists so the shape is settled. It is filled, and used by the
 * checkout command, in Phase VII (trials, Offers and Promotions). Test and live
 * Offers are different objects, so each mode has its own map.
 */
import type { ProviderMode } from "@/generated/prisma";

export interface OfferCatalogEntry {
  /** What a customer types or a link carries. Matched case-insensitively. */
  readonly marketingCode: string;
  /** The Razorpay Offer ID. */
  readonly providerOfferId: string;
}

const OFFERS: Readonly<Record<ProviderMode, readonly OfferCatalogEntry[]>> = {
  TEST: [],
  LIVE: [],
};

export function findOfferByMarketingCode(
  mode: ProviderMode,
  marketingCode: string,
): OfferCatalogEntry | undefined {
  const wanted = marketingCode.trim().toLowerCase();

  return OFFERS[mode].find((entry) => entry.marketingCode.toLowerCase() === wanted);
}
