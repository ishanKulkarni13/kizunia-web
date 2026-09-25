import { describe, expect, it } from "vitest";

import { findOfferByMarketingCode } from "./offer-catalog";
import { createPlanCatalog, getPlanCatalog, type PlanCatalogEntry } from "./plan-catalog";

const proMonthly: PlanCatalogEntry = { providerPlanId: "plan_proM_v2", plan: "PRO", cycle: "MONTHLY" };

describe("createPlanCatalog", () => {
  it("resolves a provider plan ID to its Kizunia plan and cycle", () => {
    const catalog = createPlanCatalog([
      proMonthly,
      { providerPlanId: "plan_plusY", plan: "PRO_PLUS", cycle: "YEARLY" },
    ]);

    expect(catalog.findByProviderPlanId("plan_proM_v2")).toEqual(proMonthly);
    expect(catalog.findByProviderPlanId("plan_plusY")).toMatchObject({ plan: "PRO_PLUS", cycle: "YEARLY" });
  });

  it("returns undefined for a provider plan it does not know, rather than guessing", () => {
    const catalog = createPlanCatalog([proMonthly]);

    expect(catalog.findByProviderPlanId("plan_unknown")).toBeUndefined();
  });

  it("maps many provider plans to one plan and cycle, keeping retired IDs resolvable", () => {
    const catalog = createPlanCatalog([
      { providerPlanId: "plan_proM_v1", plan: "PRO", cycle: "MONTHLY", retired: true },
      { providerPlanId: "plan_proM_v0", plan: "PRO", cycle: "MONTHLY", retired: true },
      proMonthly,
    ]);

    // An existing subscriber on a retired plan still resolves to Pro monthly.
    expect(catalog.findByProviderPlanId("plan_proM_v1")).toMatchObject({ plan: "PRO", cycle: "MONTHLY" });
    expect(catalog.findByProviderPlanId("plan_proM_v0")).toMatchObject({ plan: "PRO", cycle: "MONTHLY" });
    expect(catalog.findByProviderPlanId("plan_proM_v2")).toMatchObject({ plan: "PRO", cycle: "MONTHLY" });
  });

  it("offers only the current plan for a new purchase, never a retired one", () => {
    const catalog = createPlanCatalog([
      { providerPlanId: "plan_proM_v1", plan: "PRO", cycle: "MONTHLY", retired: true },
      proMonthly,
    ]);

    expect(catalog.currentProviderPlanId("PRO", "MONTHLY")).toBe("plan_proM_v2");
  });

  it("has no plan to sell when every entry for a plan and cycle is retired", () => {
    const catalog = createPlanCatalog([
      { providerPlanId: "plan_old", plan: "PRO", cycle: "YEARLY", retired: true },
    ]);

    expect(catalog.currentProviderPlanId("PRO", "YEARLY")).toBeUndefined();
    expect(catalog.findByProviderPlanId("plan_old")).toBeDefined();
  });

  it("has no plan to sell for a plan and cycle that is not configured", () => {
    const catalog = createPlanCatalog([proMonthly]);

    expect(catalog.currentProviderPlanId("PRO", "YEARLY")).toBeUndefined();
    expect(catalog.currentProviderPlanId("PRO_PLUS", "MONTHLY")).toBeUndefined();
  });

  it("refuses a provider plan ID listed twice", () => {
    expect(() => createPlanCatalog([proMonthly, { ...proMonthly, plan: "PRO_PLUS" }])).toThrow(
      /plan_proM_v2 is listed more than once/,
    );
  });

  it("refuses two current plans for the same plan and cycle", () => {
    expect(() =>
      createPlanCatalog([
        proMonthly,
        { providerPlanId: "plan_proM_v3", plan: "PRO", cycle: "MONTHLY" },
      ]),
    ).toThrow(/PRO MONTHLY has two current plans/);
  });

  it("refuses an empty provider plan ID", () => {
    expect(() => createPlanCatalog([{ ...proMonthly, providerPlanId: " " }])).toThrow(/empty provider plan ID/);
  });
});

describe("the shipped catalogs", () => {
  it("TEST resolves every plan and cycle both ways, through the four verification plans", () => {
    const catalog = getPlanCatalog("TEST");

    for (const plan of ["PRO", "PRO_PLUS"] as const) {
      for (const cycle of ["MONTHLY", "YEARLY"] as const) {
        const providerPlanId = catalog.currentProviderPlanId(plan, cycle);

        expect(providerPlanId, `${plan} ${cycle}`).toMatch(/^plan_/);
        expect(catalog.findByProviderPlanId(providerPlanId!)).toMatchObject({ plan, cycle });
      }
    }
    expect(catalog.findByProviderPlanId("plan_anything")).toBeUndefined();
  });

  it("LIVE is empty until pricing is decided (safe: an unmapped plan is refused)", () => {
    const catalog = getPlanCatalog("LIVE");

    expect(catalog.currentProviderPlanId("PRO", "MONTHLY")).toBeUndefined();
    expect(catalog.findByProviderPlanId("plan_TgDgeZ5thTGEr8")).toBeUndefined();
  });
});

describe("findOfferByMarketingCode (stub)", () => {
  it("finds nothing until Offers are configured", () => {
    expect(findOfferByMarketingCode("TEST", "WELCOME")).toBeUndefined();
    expect(findOfferByMarketingCode("LIVE", "  welcome ")).toBeUndefined();
  });
});
