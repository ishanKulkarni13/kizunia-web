import { afterEach, describe, expect, it } from "vitest";

import { resetLogSink, setLogSink } from "@/lib/logger";

import { adminPathFor, logBillingAlert } from "./log";

afterEach(() => resetLogSink());

describe("adminPathFor (Phase VIII: alerts link to the admin views)", () => {
  it("points at the anomaly when the alert names one", () => {
    expect(adminPathFor({ anomalyId: "an_1", userId: "u_1" })).toBe("/admin/billing/anomalies/an_1");
  });

  it("points at the user's billing page when there is a user but no anomaly", () => {
    expect(adminPathFor({ userId: "u_1" })).toBe("/admin/billing/users/u_1");
  });

  it("falls back to the billing overview, which shows the health summary", () => {
    expect(adminPathFor({})).toBe("/admin/billing");
    expect(adminPathFor({ anomalyId: "", userId: 42 })).toBe("/admin/billing");
  });

  it("encodes the id, so a crafted value cannot change the path", () => {
    expect(adminPathFor({ anomalyId: "../x?y=1" })).toBe("/admin/billing/anomalies/..%2Fx%3Fy%3D1");
  });
});

describe("logBillingAlert", () => {
  it("emits billing.alert with the condition, the severity and the admin path", () => {
    const records: { event: string; fields: Readonly<Record<string, unknown>> }[] = [];
    setLogSink((record) => {
      records.push(record);
    });

    logBillingAlert("MULTIPLE_OPEN_SUBSCRIPTIONS", "HIGH", { anomalyId: "an_9", subjectKey: "user:u_9" });

    expect(records).toHaveLength(1);
    expect(records[0].event).toBe("billing.alert");
    expect(records[0].fields).toMatchObject({
      condition: "MULTIPLE_OPEN_SUBSCRIPTIONS",
      severity: "HIGH",
      anomalyId: "an_9",
      adminPath: "/admin/billing/anomalies/an_9",
    });
  });
});
