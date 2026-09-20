import { Authorization } from "@/authorization";
import { PlatformAction } from "@/authorization/platform/actions";
import type { PlatformContext } from "@/authorization/platform/context";
import { PlatformPolicy } from "@/authorization/platform/policy";

/**
 * Announcements are a global capability with no per-instance ownership, so this
 * is a thin wrapper around the platform policy — kept as its own class to match
 * the module convention of `XxxAuthorizer.method(context)` called from the
 * service, rather than scattering `PlatformPolicy.can` through it.
 *
 * Note what is *not* here: the inbox. A user's own notifications are guarded by
 * scoping every query to their id (`NotificationService`), not by a permission.
 * That is the right shape for ownership — a `where` clause that cannot match
 * someone else's row is a stronger guarantee than a check that has to be
 * remembered, and there is no role that grants access to another person's
 * notifications.
 */
export class NotificationAnnouncementAuthorizer {
  static manage(context: PlatformContext): void {
    Authorization.assert(
      PlatformPolicy.can(
        context,
        PlatformAction.MANAGE_NOTIFICATION_ANNOUNCEMENTS,
      ),
    );
  }
}
