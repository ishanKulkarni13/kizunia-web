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
