import { PlatformPermissionSet } from "./permission-set";
import { PlatformRole } from "./roles";
import type { PlatformAction } from "./actions";

/**
 * Every role whose permission set grants `action`.
 *
 * The inverse lookup of `PlatformPolicy.can`, and it exists for one reason: a
 * background job has no actor. "Who should be told about a suggestion awaiting
 * review?" cannot be answered by asking whether *this* caller may review one —
 * there is no caller. It has to be answered by asking which roles may.
 *
 * Deriving the answer from `PlatformPermissionSet` rather than naming roles at
 * the call site is what keeps the authorization model single-sourced. The
 * comment on `MODERATOR` in that file promises that granting suggestion review
 * to moderators is a one-line addition; reading roles back out of the same
 * structure is what makes that promise true for notification recipients too,
 * instead of leaving a hard-coded `["admin", "superadmin"]` somewhere to
 * silently disagree with it later.
 *
 * Ordered by the `PlatformRole` declaration, so the result is stable and a test
 * can assert against it without sorting.
 */
export function rolesWithAction(action: PlatformAction): readonly PlatformRole[] {
  return Object.values(PlatformRole).filter((role) =>
    PlatformPermissionSet[role].has(action),
  );
}
