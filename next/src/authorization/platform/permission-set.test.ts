import { describe, expect, it } from "vitest";

import { PlatformAction } from "./actions";
import { PlatformPermissionSet } from "./permission-set";
import { PlatformRole } from "./roles";

/**
 * Regression guard for the Asset Admin authorization boundary: MANAGE_MEDIA
 * existed in PlatformAction but was granted to no role until the Asset
 * Admin surface needed it (see AssetAuthorizer). This is also, per the
 * Asset Admin implementation plan, the repo's first authorization test.
 */
describe("PlatformPermissionSet - MANAGE_MEDIA", () => {
  it("is granted to ADMIN and SUPER_ADMIN", () => {
    expect(
      PlatformPermissionSet[PlatformRole.ADMIN].has(PlatformAction.MANAGE_MEDIA),
    ).toBe(true);
    expect(
      PlatformPermissionSet[PlatformRole.SUPER_ADMIN].has(PlatformAction.MANAGE_MEDIA),
    ).toBe(true);
  });

  it("is NOT granted to USER or MODERATOR", () => {
    expect(
      PlatformPermissionSet[PlatformRole.USER].has(PlatformAction.MANAGE_MEDIA),
    ).toBe(false);
    expect(
      PlatformPermissionSet[PlatformRole.MODERATOR].has(PlatformAction.MANAGE_MEDIA),
    ).toBe(false);
  });
});

/**
 * Pins the actual semantics the /admin route-group layout guard relies on
 * (see app/(dashboard)/admin/layout.tsx): the guard checks
 * ACCESS_ADMIN_DASHBOARD, and this asserts that grant matches exactly who
 * should be let into the admin page shell.
 */
describe("PlatformPermissionSet - ACCESS_ADMIN_DASHBOARD", () => {
  it("is granted to ADMIN and SUPER_ADMIN", () => {
    expect(
      PlatformPermissionSet[PlatformRole.ADMIN].has(
        PlatformAction.ACCESS_ADMIN_DASHBOARD,
      ),
    ).toBe(true);
    expect(
      PlatformPermissionSet[PlatformRole.SUPER_ADMIN].has(
        PlatformAction.ACCESS_ADMIN_DASHBOARD,
      ),
    ).toBe(true);
  });

  it("is NOT granted to USER or MODERATOR", () => {
    expect(
      PlatformPermissionSet[PlatformRole.USER].has(
        PlatformAction.ACCESS_ADMIN_DASHBOARD,
      ),
    ).toBe(false);
    expect(
      PlatformPermissionSet[PlatformRole.MODERATOR].has(
        PlatformAction.ACCESS_ADMIN_DASHBOARD,
      ),
    ).toBe(false);
  });
});

/**
 * Billing role matrix (IB-15, product decision): SUPER_ADMIN manages grants and
 * billing and views billing; ADMIN only views; MODERATOR and USER hold none.
 * docs/architecture/subscription/implementation/open-decisions.md#ib-15--billing-admin-roles
 */
describe("PlatformPermissionSet - billing actions", () => {
  const matrix: ReadonlyArray<[PlatformAction, readonly PlatformRole[]]> = [
    [PlatformAction.MANAGE_ENTITLEMENT_GRANTS, [PlatformRole.SUPER_ADMIN]],
    [PlatformAction.MANAGE_BILLING, [PlatformRole.SUPER_ADMIN]],
    [PlatformAction.VIEW_BILLING, [PlatformRole.SUPER_ADMIN, PlatformRole.ADMIN]],
    [PlatformAction.VIEW_BILLING_RAW_PAYLOADS, [PlatformRole.SUPER_ADMIN]],
  ];

  it.each(matrix)("%s is held by exactly the expected roles", (action, holders) => {
    for (const role of Object.values(PlatformRole)) {
      expect(PlatformPermissionSet[role].has(action)).toBe(holders.includes(role));
    }
  });
});
