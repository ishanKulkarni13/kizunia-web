import { describe, expect, it } from "vitest";

import { NotificationIntent } from "@/generated/prisma";

import { UpdateNotificationPreferenceSchema } from "./notification-preference";

describe("UpdateNotificationPreferenceSchema", () => {
  it("accepts a known intent with a boolean enabled state", () => {
    const result = UpdateNotificationPreferenceSchema.parse({
      intent: NotificationIntent.TOP_RELEVANT_COMPETITION,
      enabled: true,
    });

    expect(result).toEqual({
      intent: NotificationIntent.TOP_RELEVANT_COMPETITION,
      enabled: true,
    });
  });

  it("rejects an unknown intent", () => {
    expect(() =>
      UpdateNotificationPreferenceSchema.parse({
        intent: "NOT_A_REAL_INTENT",
        enabled: true,
      }),
    ).toThrow();
  });

  it("rejects a non-boolean enabled value", () => {
    expect(() =>
      UpdateNotificationPreferenceSchema.parse({
        intent: NotificationIntent.TOP_RELEVANT_COMPETITION,
        enabled: "yes",
      }),
    ).toThrow();
  });

  it("rejects a caller-supplied userId (strict schema has no such field)", () => {
    expect(() =>
      UpdateNotificationPreferenceSchema.parse({
        intent: NotificationIntent.TOP_RELEVANT_COMPETITION,
        enabled: true,
        userId: "someone-elses-id",
      }),
    ).toThrow();
  });
});
