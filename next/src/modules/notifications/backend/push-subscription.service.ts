/**
 * Notifications — Push Subscriptions
 *
 * Business Layer
 *
 * Responsibilities
 * ----------------
 * ✓ Register, refresh and revoke a browser's push registration
 * ✓ Keep registrations scoped to the user who owns them
 *
 * Does NOT
 * ----------------
 * ✗ Send anything
 * ✗ Parse requests or read sessions — the controller supplies the actor
 *
 * ## A token identifies a browser, not a person
 *
 * This is the detail that makes the obvious implementation wrong. FCM issues a
 * token per browser installation, and it is globally unique — so when someone
 * signs out and a colleague signs in on the same machine, the *same* token
 * arrives belonging to a different user.
 *
 * Inserting would violate the unique constraint and reject a perfectly
 * legitimate registration. So registration **moves** the token to its current
 * owner instead, which also has the property you want: the previous user stops
 * receiving notifications on a browser they no longer control.
 */
import { logNotificationEvent } from "../observability/log";
import type { PushSubscriptionDTO } from "../types/notification.dto";
import { PushSubscriptionRepository } from "./push-subscription.repository";

export class PushSubscriptionService {
  /**
   * Registers a browser, or re-registers one that already exists.
   *
   * Idempotent by nature: a browser re-registers on most visits, because the
   * SDK may rotate a token at any time and the client cannot tell whether the
   * one it holds is already known here.
   *
   * Re-registering also **reactivates** a subscription previously marked
   * invalid. A token we gave up on that is presenting itself again is evidence
   * the browser is alive; refusing it would leave a user permanently unable to
   * re-enable push after one bad delivery run.
   */
  static async register(input: {
    userId: string;
    token: string;
    userAgent?: string | null;
  }): Promise<PushSubscriptionDTO> {
    const now = new Date();

    const subscription = await PushSubscriptionRepository.upsertByToken({
      userId: input.userId,
      token: input.token,
      userAgent: input.userAgent,
      now,
    });

    logNotificationEvent("push.subscription_registered", {
      subscriptionId: subscription.id,
      userId: input.userId,
    });

    return toDTO(subscription);
  }

  static async listForUser(userId: string): Promise<PushSubscriptionDTO[]> {
    const rows = await PushSubscriptionRepository.findForUser(userId);

    return rows.map(toDTO);
  }

  /**
   * Revokes one of the caller's own subscriptions.
   *
   * Scoped by user id inside the `where`, so a query that could match someone
   * else's row is not expressible — a stronger guarantee than a check
   * afterwards, which is a check someone can forget to write.
   *
   * Marked revoked rather than deleted: delivery records reference it, and
   * "this device was unsubscribed" is a more useful thing to find later than a
   * dangling null.
   */
  static async revoke(userId: string, subscriptionId: string): Promise<boolean> {
    return PushSubscriptionRepository.revokeById(userId, subscriptionId, new Date());
  }

  /** Revokes by token, for a client that knows its token but not its row id. */
  static async revokeByToken(userId: string, token: string): Promise<boolean> {
    return PushSubscriptionRepository.revokeByToken(userId, token, new Date());
  }
}

function toDTO(row: {
  id: string;
  provider: string;
  userAgent: string | null;
  status: string;
  createdAt: Date;
  lastSeenAt: Date;
}): PushSubscriptionDTO {
  return {
    id: row.id,
    provider: row.provider,
    // The token itself is deliberately never returned. It is a delivery
    // credential, the client already has its own, and echoing every one of a
    // user's tokens back to any of their sessions is a needless way to leak
    // them.
    userAgent: row.userAgent,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}
