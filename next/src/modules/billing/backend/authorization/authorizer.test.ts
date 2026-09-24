import { describe, expect, it } from "vitest";

import { PlatformRole } from "@/authorization";
import { ForbiddenError } from "@/lib/errors";

import { BillingAuthorizer } from "./authorizer";

function context(role: string, banned = false) {
  return { actor: { id: "u1", role, banned } };
}

describe("BillingAuthorizer (IB-15 role matrix)", () => {
  it("lets only SUPER_ADMIN manage grants", () => {
    expect(() => BillingAuthorizer.manageGrants(context(PlatformRole.SUPER_ADMIN))).not.toThrow();

    for (const role of [PlatformRole.ADMIN, PlatformRole.MODERATOR, PlatformRole.USER]) {
      expect(() => BillingAuthorizer.manageGrants(context(role))).toThrow(ForbiddenError);
    }
  });

  it("lets SUPER_ADMIN and ADMIN view billing, and nobody else", () => {
    expect(() => BillingAuthorizer.viewBilling(context(PlatformRole.SUPER_ADMIN))).not.toThrow();
    expect(() => BillingAuthorizer.viewBilling(context(PlatformRole.ADMIN))).not.toThrow();
    expect(() => BillingAuthorizer.viewBilling(context(PlatformRole.MODERATOR))).toThrow(ForbiddenError);
    expect(() => BillingAuthorizer.viewBilling(context(PlatformRole.USER))).toThrow(ForbiddenError);
  });

  it("refuses a banned SUPER_ADMIN everything", () => {
    expect(() => BillingAuthorizer.manageGrants(context(PlatformRole.SUPER_ADMIN, true))).toThrow(
      ForbiddenError,
    );
    expect(() => BillingAuthorizer.viewBilling(context(PlatformRole.SUPER_ADMIN, true))).toThrow(
      ForbiddenError,
    );
  });

  it("reports the manage permission as a flag without throwing", () => {
    expect(BillingAuthorizer.canManageGrants(context(PlatformRole.SUPER_ADMIN))).toBe(true);
    expect(BillingAuthorizer.canManageGrants(context(PlatformRole.ADMIN))).toBe(false);
  });
});
