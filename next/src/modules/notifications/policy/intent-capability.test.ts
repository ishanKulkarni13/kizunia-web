import { describe, expect, it } from "vitest";

import { NotificationIntent } from "@/generated/prisma";
import { Capability } from "@/lib/entitlements/catalog";

import { INTENT_REQUIRED_CAPABILITY, requiredCapabilityFor } from "./intent-capability";

describe("intent capability map (Subscription IB-2)", () => {
  it("gates deadline notifications behind the deadline capability", () => {
    expect(requiredCapabilityFor(NotificationIntent.REGISTRATION_CLOSING)).toBe(
      Capability.DEADLINE_NOTIFICATIONS,
    );
  });

  it("gates competition recommendations behind the recommendations capability", () => {
    expect(requiredCapabilityFor(NotificationIntent.TOP_RELEVANT_COMPETITION)).toBe(
      Capability.RECOMMENDATIONS,
    );
  });

  it("leaves every other intent ungated", () => {
    expect(requiredCapabilityFor(NotificationIntent.FEATURE_ANNOUNCEMENT)).toBeNull();
    expect(requiredCapabilityFor(NotificationIntent.ADMIN_COMPETITION_SUGGESTION)).toBeNull();
  });

  it("gates exactly the two paid intents and nothing else", () => {
    expect(Object.keys(INTENT_REQUIRED_CAPABILITY).sort()).toEqual([
      "REGISTRATION_CLOSING",
      "TOP_RELEVANT_COMPETITION",
    ]);
  });
});
