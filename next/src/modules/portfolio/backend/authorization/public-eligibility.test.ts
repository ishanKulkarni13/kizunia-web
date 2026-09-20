import { describe, expect, it } from "vitest";

import { resolvePortfolioPublicEligibility } from "./public-eligibility";

/**
 * Cheap tripwire: this stub must stay `true` until a real entitlement
 * system backs it (see the doc comment on the function). If this test ever
 * needs updating, that's a signal the seam is being wired up for real — the
 * policy tests (policy.test.ts) already cover both `true` and `false`
 * behavior via a synthetic PortfolioContext.
 */
describe("resolvePortfolioPublicEligibility", () => {
  it("is true for every owner today", () => {
    expect(resolvePortfolioPublicEligibility({ ownerUserId: "any-user" })).toBe(true);
  });
});
