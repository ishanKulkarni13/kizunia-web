/**
 * Billing — Offer Code Source
 *
 * The one narrow, asynchronous seam through which the billing code learns what
 * a marketing code means (IB-27 item 6). Its only implementation today reads
 * the static, per-mode catalog in `config/offer-catalog.ts`. Everything that
 * evaluates or applies a code (`policy/code-eligibility.ts`, the checkout
 * commands, the promotion service) depends on this port and on
 * `OfferCodeDefinition`, never on the catalog file or on a Razorpay Offer ID.
 *
 * That is what keeps the future change small. Later, an admin copies a
 * Razorpay `offer_id` and its metadata into Kizunia's admin dashboard and it is
 * stored in the database, with no deploy: a second implementation of this
 * interface, reading a table. The eligibility rules, checkout, redemption and
 * entitlement code do not change, and the interface is already asynchronous
 * for that reason. It is deliberately not generalized any further (no multiple
 * providers, no registry): it has exactly the two questions callers ask.
 *
 * The definition's `offerRef` is the provider's Offer, opaque here. It is
 * stored on the subscription's `offerId` column and read once, by the create
 * step, to send it; it is never returned to a browser (SB-PB-04).
 */
import type { ProviderMode } from "@/generated/prisma";

import { getOfferCatalog, offerCodeExistsInAnyMode, type OfferCatalog, type OfferCatalogEntry } from "../../config/offer-catalog";
import { normalizeCode, type OfferCodeDefinition } from "../../policy/code-eligibility";

export interface OfferCodeSource {
  /** The definition of `code` in `mode`, or `null` when this mode does not sell it. */
  findByCode(mode: ProviderMode, code: string): Promise<OfferCodeDefinition | null>;
  /** Whether `code` is an Offer code in any mode (a promotion code must not collide with one). */
  existsInAnyMode(code: string): Promise<boolean>;
}

function toDefinition(entry: OfferCatalogEntry): OfferCodeDefinition {
  return {
    code: normalizeCode(entry.marketingCode),
    offerRef: entry.providerOfferId,
    appliesTo: entry.appliesTo,
    eligibility: entry.eligibility,
    validFrom: entry.validFrom ?? null,
    validUntil: entry.validUntil ?? null,
    description: entry.description,
  };
}

/** The V1 source: the static, code-reviewed catalog. `catalogFor` is injectable for tests. */
export function createStaticOfferCodeSource(catalogFor: (mode: ProviderMode) => OfferCatalog = getOfferCatalog, anyMode = offerCodeExistsInAnyMode): OfferCodeSource {
  return {
    async findByCode(mode, code) {
      const entry = catalogFor(mode).findByCode(code);

      return entry ? toDefinition(entry) : null;
    },
    async existsInAnyMode(code) {
      return anyMode(code);
    },
  };
}

let source: OfferCodeSource | undefined;

export function getOfferCodeSource(): OfferCodeSource {
  source ??= createStaticOfferCodeSource();

  return source;
}
