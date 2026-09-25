import { describe, expect, it } from "vitest";

import {
  Capability,
  EffectivePlan,
  PLAN_CATALOG,
  PLAN_ORDER,
  Quota,
  accessForPlan,
  maxPlan,
  minimumPlanFor,
  PLAN_DISPLAY_NAME,
  paidPlansWith,
  planHasCapability,
  plansWith,
  quotaFor,
} from "./catalog";

/**
 * The feature matrix, transcribed from
 * docs/project/feature-specification/subscription/plans.md. If the product
 * moves a capability between plans, that document and `catalog.ts` change
 * together, and so does this table.
 */
const EXPECTED: Record<EffectivePlan, { capabilities: Capability[]; ownedProjects: number }> = {
  FREE: { capabilities: [], ownedProjects: 5 },
  PRO: {
    capabilities: [Capability.PORTFOLIO, Capability.DEADLINE_NOTIFICATIONS],
    ownedProjects: 10,
  },
  PRO_PLUS: {
    capabilities: [
      Capability.PORTFOLIO,
      Capability.DEADLINE_NOTIFICATIONS,
      Capability.RECOMMENDATIONS,
      Capability.MCP,
    ],
    ownedProjects: 20,
  },
};

describe("plan catalog", () => {
  it("defines exactly FREE, PRO and PRO_PLUS, lowest to highest", () => {
    expect(PLAN_ORDER).toEqual(["FREE", "PRO", "PRO_PLUS"]);
    expect(Object.keys(PLAN_CATALOG).sort()).toEqual(["FREE", "PRO", "PRO_PLUS"]);
  });

  it.each(PLAN_ORDER)("matches the product feature matrix for %s", (plan) => {
    const expected = EXPECTED[plan];

    for (const capability of Object.values(Capability)) {
      expect(planHasCapability(plan, capability)).toBe(expected.capabilities.includes(capability));
    }
    expect(quotaFor(plan, Quota.OWNED_PROJECTS)).toBe(expected.ownedProjects);
  });

  it("recommendations require Pro+, not Pro (SB-PL-05)", () => {
    expect(plansWith(Capability.RECOMMENDATIONS)).toEqual([EffectivePlan.PRO_PLUS]);
  });

  it("lists the plans and the storable paid plans with a capability", () => {
    expect(plansWith(Capability.PORTFOLIO)).toEqual(["PRO", "PRO_PLUS"]);
    expect(paidPlansWith(Capability.MCP)).toEqual(["PRO_PLUS"]);
    expect(paidPlansWith(Capability.DEADLINE_NOTIFICATIONS)).toEqual(["PRO", "PRO_PLUS"]);
  });

  it("never lets a higher plan have less than a lower one", () => {
    for (let i = 1; i < PLAN_ORDER.length; i++) {
      const lower = PLAN_CATALOG[PLAN_ORDER[i - 1]];
      const higher = PLAN_CATALOG[PLAN_ORDER[i]];

      for (const capability of lower.capabilities) {
        expect(higher.capabilities.has(capability)).toBe(true);
      }
      for (const quota of Object.values(Quota)) {
        expect(higher.quotas[quota]).toBeGreaterThanOrEqual(lower.quotas[quota]);
      }
    }
  });
});

describe("maxPlan", () => {
  it("is FREE for no sources", () => {
    expect(maxPlan([])).toBe("FREE");
  });

  it("takes the highest plan regardless of order (SB-EA-02)", () => {
    expect(maxPlan(["PRO", "PRO_PLUS", "PRO"])).toBe("PRO_PLUS");
    expect(maxPlan(["PRO_PLUS", "PRO"])).toBe("PRO_PLUS");
    expect(maxPlan(["PRO"])).toBe("PRO");
  });
});

describe("accessForPlan", () => {
  it("flattens capabilities and quotas for a plan", () => {
    expect(accessForPlan("PRO")).toEqual({
      plan: "PRO",
      capabilities: {
        PORTFOLIO: true,
        DEADLINE_NOTIFICATIONS: true,
        RECOMMENDATIONS: false,
        MCP: false,
      },
      quotas: { OWNED_PROJECTS: 10 },
    });
  });
});

describe("minimumPlanFor", () => {
  it("names the lowest plan that includes each capability", () => {
    expect(minimumPlanFor(Capability.PORTFOLIO)).toBe(EffectivePlan.PRO);
    expect(minimumPlanFor(Capability.DEADLINE_NOTIFICATIONS)).toBe(EffectivePlan.PRO);
    expect(minimumPlanFor(Capability.RECOMMENDATIONS)).toBe(EffectivePlan.PRO_PLUS);
    expect(minimumPlanFor(Capability.MCP)).toBe(EffectivePlan.PRO_PLUS);
  });

  it("has a display name for every plan", () => {
    expect(PLAN_DISPLAY_NAME).toEqual({ FREE: "Free", PRO: "Pro", PRO_PLUS: "Pro+" });
  });
});
