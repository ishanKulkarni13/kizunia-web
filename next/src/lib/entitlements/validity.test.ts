import { describe, expect, it } from "vitest";

import { grantStateAt, isGrantContributing, type GrantWindow } from "./validity";

const from = new Date("2026-09-24T00:00:00.000Z");
const until = new Date("2026-10-24T00:00:00.000Z");

function grant(overrides: Partial<GrantWindow> = {}): GrantWindow {
  return { status: "ACTIVE", validFrom: from, validUntil: until, ...overrides };
}

describe("grant validity", () => {
  it("contributes from validFrom inclusive", () => {
    expect(grantStateAt(grant(), from)).toBe("ACTIVE");
    expect(isGrantContributing(grant(), from)).toBe(true);
  });

  it("does not contribute before validFrom", () => {
    expect(grantStateAt(grant(), new Date(from.getTime() - 1))).toBe("SCHEDULED");
  });

  it("stops contributing at validUntil exclusive", () => {
    expect(grantStateAt(grant(), new Date(until.getTime() - 1))).toBe("ACTIVE");
    expect(grantStateAt(grant(), until)).toBe("EXPIRED");
    expect(isGrantContributing(grant(), until)).toBe(false);
  });

  it("never expires without a validUntil", () => {
    expect(grantStateAt(grant({ validUntil: null }), new Date("2100-01-01T00:00:00Z"))).toBe("ACTIVE");
  });

  it("a revoked grant never contributes, whatever its window says", () => {
    expect(grantStateAt(grant({ status: "REVOKED" }), from)).toBe("REVOKED");
    expect(isGrantContributing(grant({ status: "REVOKED", validUntil: null }), from)).toBe(false);
  });
});
