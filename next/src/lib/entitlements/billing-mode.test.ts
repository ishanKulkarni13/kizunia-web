import { describe, expect, it } from "vitest";

import { expectedBillingMode } from "./billing-mode";

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

describe("expectedBillingMode", () => {
  it("uses BILLING_EXPECTED_MODE when it is set", () => {
    expect(expectedBillingMode(env({ BILLING_EXPECTED_MODE: "live" }))).toBe("LIVE");
    expect(expectedBillingMode(env({ BILLING_EXPECTED_MODE: "test" }))).toBe("TEST");
  });

  it("lets an explicit value override VERCEL_ENV in both directions", () => {
    expect(expectedBillingMode(env({ BILLING_EXPECTED_MODE: "test", VERCEL_ENV: "production" }))).toBe("TEST");
    expect(expectedBillingMode(env({ BILLING_EXPECTED_MODE: "live", VERCEL_ENV: "preview" }))).toBe("LIVE");
  });

  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(expectedBillingMode(env({ BILLING_EXPECTED_MODE: "  LIVE " }))).toBe("LIVE");
    expect(expectedBillingMode(env({ BILLING_EXPECTED_MODE: "Test" }))).toBe("TEST");
  });

  it("falls back to LIVE for a Vercel production deployment", () => {
    expect(expectedBillingMode(env({ VERCEL_ENV: "production" }))).toBe("LIVE");
  });

  it("falls back to TEST everywhere else", () => {
    expect(expectedBillingMode(env({ VERCEL_ENV: "preview" }))).toBe("TEST");
    expect(expectedBillingMode(env({ VERCEL_ENV: "development" }))).toBe("TEST");
    expect(expectedBillingMode(env({}))).toBe("TEST");
  });

  it("treats an empty BILLING_EXPECTED_MODE as unset", () => {
    expect(expectedBillingMode(env({ BILLING_EXPECTED_MODE: "  ", VERCEL_ENV: "production" }))).toBe("LIVE");
  });

  it("refuses a value that is neither test nor live, rather than guessing a side", () => {
    expect(() => expectedBillingMode(env({ BILLING_EXPECTED_MODE: "prod" }))).toThrow(
      /BILLING_EXPECTED_MODE must be "test" or "live"/,
    );
  });
});
