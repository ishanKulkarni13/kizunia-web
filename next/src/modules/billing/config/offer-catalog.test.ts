import { describe, expect, it } from "vitest";

import { createOfferCatalog, getOfferCatalog, offerCodeExistsInAnyMode, type OfferCatalogEntry } from "./offer-catalog";

function entry(overrides: Partial<OfferCatalogEntry> = {}): OfferCatalogEntry {
  return {
    marketingCode: "Welcome",
    providerOfferId: "offer_A",
    appliesTo: [{ plan: "PRO", cycle: "MONTHLY" }],
    eligibility: "ANY_USER",
    description: "Half off your first month",
    ...overrides,
  };
}

describe("createOfferCatalog", () => {
  it("finds a code case-insensitively and ignoring surrounding space", () => {
    const catalog = createOfferCatalog([entry()]);

    expect(catalog.findByCode("  welcome ")?.providerOfferId).toBe("offer_A");
    expect(catalog.findByCode("WELCOME")?.providerOfferId).toBe("offer_A");
    expect(catalog.findByCode("other")).toBeUndefined();
    expect(catalog.codes()).toEqual(["WELCOME"]);
  });

  it("refuses a code that appears twice after normalization", () => {
    expect(() => createOfferCatalog([entry(), entry({ marketingCode: " welcome ", providerOfferId: "offer_B" })])).toThrow(/appears twice/);
  });

  it("refuses an Offer ID that appears twice", () => {
    expect(() => createOfferCatalog([entry(), entry({ marketingCode: "OTHER" })])).toThrow(/appears twice/);
  });

  it("refuses an empty code, an empty Offer ID, no plan, and a window that ends before it starts", () => {
    expect(() => createOfferCatalog([entry({ marketingCode: "  " })])).toThrow(/empty marketing code/);
    expect(() => createOfferCatalog([entry({ providerOfferId: " " })])).toThrow(/no Razorpay Offer ID/);
    expect(() => createOfferCatalog([entry({ appliesTo: [] })])).toThrow(/applies to no plan/);
    expect(() =>
      createOfferCatalog([entry({ validFrom: new Date("2026-10-01T00:00:00Z"), validUntil: new Date("2026-09-01T00:00:00Z") })]),
    ).toThrow(/ends before it starts/);
  });
});

describe("the shipped catalogs", () => {
  it("load, which is the invariant check for every configured entry (unique codes and Offer IDs per mode)", () => {
    expect(() => getOfferCatalog("TEST").codes()).not.toThrow();
    expect(() => getOfferCatalog("LIVE").codes()).not.toThrow();
  });

  it("keep TEST and LIVE from sharing a provider Offer ID: they are different objects in different accounts", () => {
    const ids = (mode: "TEST" | "LIVE") =>
      getOfferCatalog(mode)
        .codes()
        .map((code) => getOfferCatalog(mode).findByCode(code)!.providerOfferId);
    const shared = ids("TEST").filter((id) => ids("LIVE").includes(id));

    expect(shared).toEqual([]);
  });

  it("answers whether a code is an Offer code in any mode, for the promotion/Offer disjointness rule (SB-CP-01)", () => {
    for (const mode of ["TEST", "LIVE"] as const) {
      for (const code of getOfferCatalog(mode).codes()) expect(offerCodeExistsInAnyMode(code)).toBe(true);
    }

    expect(offerCodeExistsInAnyMode("NOT-A-CODE-ANYWHERE")).toBe(false);
  });
});
