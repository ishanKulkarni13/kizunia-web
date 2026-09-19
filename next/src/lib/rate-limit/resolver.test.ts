import { describe, expect, it } from "vitest";

import { resolveEntitlements } from "@/lib/entitlements";

import { RATE_LIMIT_POLICIES, RateLimitPolicyId, type RateLimitPolicyId as RateLimitPolicyIdType } from "./policies";
import { resolvePolicy } from "./resolver";
import { globalSubject } from "./subject";

describe("resolvePolicy", () => {
  it("returns the registry values for a known policy id", () => {
    const registryEntry = RATE_LIMIT_POLICIES[RateLimitPolicyId.PLACES_AUTOCOMPLETE];

    const effective = resolvePolicy(
      RateLimitPolicyId.PLACES_AUTOCOMPLETE,
      globalSubject(),
      resolveEntitlements(),
    );

    expect(effective).toEqual({
      limit: registryEntry.limit,
      windowSeconds: registryEntry.windowSeconds,
      failureMode: registryEntry.failureMode,
      subjectStrategies: registryEntry.subjectStrategies,
    });
  });

  it("defaults to the default entitlement tier when none is passed", () => {
    const entitlements = resolveEntitlements();

    expect(entitlements.tier).toBe("default");
  });

  it("throws a clear error for an unknown policy id", () => {
    const bogusId = "not:a-real-policy" as RateLimitPolicyIdType;

    expect(() =>
      resolvePolicy(bogusId, globalSubject(), resolveEntitlements()),
    ).toThrow(/Unknown rate limit policy id/);
  });

  it("every registered policy has at least one subject strategy", () => {
    for (const policy of Object.values(RATE_LIMIT_POLICIES)) {
      expect(policy.subjectStrategies.length).toBeGreaterThan(0);
    }
  });
});
