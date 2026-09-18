/**
 * Notifications — Intent Audience
 *
 * Pure. Which intents apply to whom.
 *
 * ## Why this exists at all
 *
 * Every intent before `ADMIN_COMPETITION_SUGGESTION` applied to every user, so
 * "audience" was not a concept the system needed: the preferences page could
 * render the whole enum, and the only question was whether a given person had
 * switched an intent on.
 *
 * An operational intent breaks that. A suggestion awaiting review is not
 * something a regular member can act on, and listing "New competition
 * suggestions" among their notification settings would offer a switch that
 * controls nothing — the recipient query would never select them regardless of
 * its position. A setting that does nothing is worse than an absent one,
 * because it invites the reader to believe it does something.
 *
 * ## Why the audience is an action and not a role
 *
 * The map names a `PlatformAction`, never a role. Roles are how the platform
 * *grants* capability; actions are what the capability *is*. Keying on the
 * action means the day `MODERATOR` gains `REVIEW_COMPETITION_SUGGESTIONS` —
 * which `permission-set.ts` explicitly anticipates as a one-line change —
 * moderators start both receiving these notifications and seeing the setting,
 * with nothing here to remember to update.
 *
 * Type-only Prisma import and string-literal keys, so this file is safe in a
 * client bundle. `notification-intent-copy.ts` is written the same way, for the
 * same reason.
 */
import { PlatformAction } from "@/authorization/platform/actions";
import type { NotificationIntent } from "@/generated/prisma";

/**
 * The action an intent's audience is defined by, for intents that have one.
 *
 * Partial on purpose. An absent entry means "everyone", which is the right
 * default: the audience of a notification about *your* interests is you, and
 * requiring every future intent to declare that explicitly would be ceremony
 * with no reader.
 */
export const INTENT_REQUIRED_ACTION: Readonly<
  Partial<Record<NotificationIntent, PlatformAction>>
> = {
  ADMIN_COMPETITION_SUGGESTION: PlatformAction.REVIEW_COMPETITION_SUGGESTIONS,
};

/**
 * Whether an intent is meaningful for someone holding `actions`.
 *
 * Fails closed: a caller that cannot establish what the actor may do gets the
 * unrestricted intents only. The cost of that being wrong is a missing setting;
 * the cost of the opposite is an admin-only surface shown to a member.
 */
export function isIntentVisibleTo(
  intent: NotificationIntent,
  actions: ReadonlySet<PlatformAction>,
): boolean {
  const required = INTENT_REQUIRED_ACTION[intent];

  return required === undefined || actions.has(required);
}
