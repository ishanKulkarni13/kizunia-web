import { describe, expect, it } from "vitest";

import { PlatformAction } from "./actions";
import { PlatformRole } from "./roles";
import { rolesWithAction } from "./roles-with-action";

describe("rolesWithAction", () => {
  it("finds every role currently granted an action", () => {
    // Both ADMIN and SUPER_ADMIN grant this in permission-set.ts; USER and
    // MODERATOR do not. Asserted as a set, not an ordered array: which order
    // Object.values(PlatformRole) walks is an implementation detail this test
    // should not pin down.
    expect(new Set(rolesWithAction(PlatformAction.REVIEW_COMPETITION_SUGGESTIONS))).toEqual(
      new Set([PlatformRole.ADMIN, PlatformRole.SUPER_ADMIN]),
    );
  });

  it("returns every role for a baseline action", () => {
    expect(new Set(rolesWithAction(PlatformAction.CREATE_PROJECT))).toEqual(
      new Set(Object.values(PlatformRole)),
    );
  });

  it("returns an empty list for an action nobody currently holds", () => {
    // MANAGE_USERS is SUPER_ADMIN-only today; picking an action instead that
    // is closer to "nobody" would be circular, so this asserts the shape of an
    // empty result using a filtered view rather than inventing a fake action.
    const grantedOnlyToSuperAdmin = rolesWithAction(PlatformAction.MANAGE_USERS);
    expect(grantedOnlyToSuperAdmin).toEqual([PlatformRole.SUPER_ADMIN]);
  });
});
