import { describe, expect, it } from "vitest";

import { ORPHAN_CONFIG, RETENTION_CONFIG, SYNC_CONFIG } from "@/modules/billing/config/billing-config";
import { JOB_CONFIG } from "@/modules/notifications/config/notification-config";

import { maxDuration } from "./route";
import { TICK_TASKS } from "./tasks";

describe("the tick's task order and budgets (IB-10)", () => {
  it("runs billing:sync first, before notifications:tick", () => {
    const ids = TICK_TASKS.map((task) => task.id);

    expect(ids[0]).toBe("billing:sync");
    expect(ids.indexOf("billing:sync")).toBeLessThan(ids.indexOf("notifications:tick"));
  });

  it("runs billing:sync on every tick", () => {
    expect(TICK_TASKS.find((task) => task.id === "billing:sync")?.minIntervalSeconds).toBeLessThanOrEqual(60);
  });

  it("keeps billing (plus one provider timeout) and notifications inside maxDuration with headroom", () => {
    const worstCaseMs = SYNC_CONFIG.wallClockMs + 10_000 + JOB_CONFIG.wallClockBudgetMs;

    expect(SYNC_CONFIG.wallClockMs).toBe(10_000);
    expect(JOB_CONFIG.wallClockBudgetMs).toBe(30_000);
    expect(worstCaseMs).toBeLessThanOrEqual(maxDuration * 1000 - 10_000);
  });

  it("runs billing:orphan-discovery last, at low frequency, so it only takes what the others leave (IB-25 item 6)", () => {
    const ids = TICK_TASKS.map((task) => task.id);
    const orphan = TICK_TASKS.find((task) => task.id === "billing:orphan-discovery");

    expect(ids.at(-1)).toBe("billing:orphan-discovery");
    expect(orphan?.minIntervalSeconds).toBeGreaterThanOrEqual(15 * 60);
    expect(ORPHAN_CONFIG.wallClockMs).toBeLessThanOrEqual(10_000);
  });

  it("runs billing:payload-prune daily, before the orphan scan, on a small budget (Phase VIII)", () => {
    const ids = TICK_TASKS.map((task) => task.id);
    const prune = TICK_TASKS.find((task) => task.id === "billing:payload-prune");

    expect(prune?.minIntervalSeconds).toBe(24 * 60 * 60);
    expect(ids.indexOf("billing:payload-prune")).toBeGreaterThan(ids.indexOf("assets:reconcile"));
    expect(ids.indexOf("billing:payload-prune")).toBeLessThan(ids.indexOf("billing:orphan-discovery"));
    expect(RETENTION_CONFIG.pruneWallClockMs).toBeLessThanOrEqual(5_000);
  });
});
