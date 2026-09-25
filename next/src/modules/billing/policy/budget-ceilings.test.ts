import { describe, expect, it } from "vitest";

import { ProviderPriority } from "../provider/types";
import { budgetCeilings } from "./budget-ceilings";

const defaults = { limit: 60, headroomForPriority1: 15, headroomForPriority2: 15, orphanCeiling: 10 };

describe("budgetCeilings", () => {
  it("gives commands the whole window and reserves headroom against everyone below", () => {
    expect(budgetCeilings(defaults)).toEqual({
      [ProviderPriority.COMMAND]: 60,
      [ProviderPriority.CONFIRMATION]: 45,
      [ProviderPriority.RECONCILIATION]: 30,
      [ProviderPriority.ORPHAN_DISCOVERY]: 10,
    });
  });

  it("never lets a lower priority have more than a higher one", () => {
    for (const settings of [
      defaults,
      { limit: 10, headroomForPriority1: 2, headroomForPriority2: 2, orphanCeiling: 50 },
      { limit: 5, headroomForPriority1: 9, headroomForPriority2: 9, orphanCeiling: 3 },
      { limit: 100, headroomForPriority1: 0, headroomForPriority2: 0, orphanCeiling: 100 },
    ]) {
      const c = budgetCeilings(settings);

      expect(c[1]).toBeGreaterThanOrEqual(c[2]);
      expect(c[2]).toBeGreaterThanOrEqual(c[3]);
      expect(c[3]).toBeGreaterThanOrEqual(c[4]);
      expect(Math.min(...Object.values(c))).toBeGreaterThanOrEqual(0);
    }
  });

  it("caps orphan discovery at its own small share, and never above reconciliation", () => {
    expect(budgetCeilings({ ...defaults, orphanCeiling: 5 })[4]).toBe(5);
    expect(budgetCeilings({ ...defaults, orphanCeiling: 500 })[4]).toBe(30);
  });

  it("shuts the background priorities out entirely when headroom swallows the limit", () => {
    const c = budgetCeilings({ limit: 10, headroomForPriority1: 10, headroomForPriority2: 5, orphanCeiling: 10 });

    expect(c[1]).toBe(10);
    expect(c[2]).toBe(0);
    expect(c[3]).toBe(0);
    expect(c[4]).toBe(0);
  });

  it("handles a zero limit", () => {
    expect(Object.values(budgetCeilings({ ...defaults, limit: 0 }))).toEqual([0, 0, 0, 0]);
  });
});
