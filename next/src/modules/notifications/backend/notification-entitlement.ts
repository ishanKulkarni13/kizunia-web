/**
 * Notifications — Intent Entitlement
 *
 * The notification subsystem's one door to `lib/entitlements`: "may this user
 * (or which users may) receive this intent?", answered from the capability
 * map in `policy/intent-capability.ts`.
 *
 * Two shapes of the same rule, so the scheduler and the re-checks cannot
 * disagree (Subscription IB-2):
 *
 * - `entitledUsersWhereForIntent` — set-based, merged into the scheduler's
 *   existing eligible-user query; never one resolver call per user.
 * - `isEntitledToIntent` — per user, for the evaluation and delivery
 *   re-checks, which guard against access lost between scheduling and
 *   sending.
 *
 * There is no admin bypass here. Background work has no actor, and a platform
 * role is never an entitlement source (IB-7, SB-EA-04): an administrator
 * receives gated notifications only with a grant.
 *
 * Preferences are not consulted and never changed here (IB-16).
 */
import type { NotificationIntent, Prisma } from "@/generated/prisma";
import { entitledUsersWhere, hasCapability } from "@/lib/entitlements";

import { requiredCapabilityFor } from "../policy/intent-capability";

/**
 * A `User` filter selecting the users entitled to `intent` at `now`; `{}` for
 * an intent that requires no capability.
 */
export function entitledUsersWhereForIntent(
  intent: NotificationIntent,
  now: Date,
): Prisma.UserWhereInput {
  const capability = requiredCapabilityFor(intent);

  return capability === null ? {} : entitledUsersWhere(capability, now);
}

/**
 * Whether `userId` may receive `intent` now. Always `true` for an intent that
 * requires no capability, without a database read.
 *
 * `now` defaults to the wall clock on purpose: a re-check asks about access
 * as it is at this moment, not as it was when the work was scheduled.
 */
export async function isEntitledToIntent(
  userId: string,
  intent: NotificationIntent,
  now: Date = new Date(),
): Promise<boolean> {
  const capability = requiredCapabilityFor(intent);

  return capability === null ? true : hasCapability(userId, capability, { now });
}
