import { beforeEach, describe, expect, it, vi } from "vitest";

const { hasCapabilityMock } = vi.hoisted(() => ({ hasCapabilityMock: vi.fn() }));

vi.mock("@/lib/entitlements", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/entitlements")>()),
  hasCapability: hasCapabilityMock,
}));

import { Capability } from "@/lib/entitlements";

import { resolvePortfolioPublicEligibility } from "./public-eligibility";

/**
 * Replaces the Phase-I-era tripwire ("always true"). Eligibility is now the
 * OWNER's portfolio capability (IB-5); the policy tests (policy.test.ts) cover
 * what the policy does with either answer, and the integration suite drives
 * it with real grants.
 */
describe("resolvePortfolioPublicEligibility", () => {
  beforeEach(() => hasCapabilityMock.mockReset());

  it("asks for the owner's portfolio capability", async () => {
    hasCapabilityMock.mockResolvedValue(true);

    await expect(resolvePortfolioPublicEligibility({ ownerUserId: "owner-1" })).resolves.toBe(true);
    expect(hasCapabilityMock).toHaveBeenCalledWith("owner-1", Capability.PORTFOLIO);
  });

  it("is false when the owner's access does not include portfolios", async () => {
    hasCapabilityMock.mockResolvedValue(false);

    await expect(resolvePortfolioPublicEligibility({ ownerUserId: "owner-1" })).resolves.toBe(false);
  });
});
