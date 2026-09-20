/**
 * Notifications — Push Subscription Repository
 *
 * Database Layer
 *
 * Responsibilities
 * ----------------
 * ✓ Build and execute push-subscription queries
 *
 * Does NOT
 * ----------------
 * ✗ Business rules  ✗ Validation  ✗ Authentication  ✗ Authorization
 */
import { PushSubscriptionStatus } from "@/generated/prisma";
import prisma from "@/lib/prisma";

export class PushSubscriptionRepository {
  /**
   * Creates a subscription, or moves an existing token to its current owner.
   *
   * See `push-subscription.service.ts`'s file docstring for why the token is
   * moved rather than left in place: a token identifies a browser, not the
   * person using it.
   */
  static async upsertByToken(input: {
    userId: string;
    token: string;
    userAgent?: string | null;
    now: Date;
  }) {
    return prisma.pushSubscription.upsert({
      where: { token: input.token },
      create: {
        userId: input.userId,
        token: input.token,
        userAgent: input.userAgent ?? null,
      },
      update: {
        userId: input.userId,
        userAgent: input.userAgent ?? null,
        status: PushSubscriptionStatus.ACTIVE,
        consecutiveFailures: 0,
        invalidatedAt: null,
        lastSeenAt: input.now,
      },
    });
  }

  static async findForUser(userId: string) {
    return prisma.pushSubscription.findMany({
      where: { userId, status: { not: PushSubscriptionStatus.REVOKED } },
      orderBy: { lastSeenAt: "desc" },
    });
  }

  /** Scoped by user id in the `where`, so it cannot match someone else's row. */
  static async revokeById(userId: string, subscriptionId: string, now: Date): Promise<boolean> {
    const result = await prisma.pushSubscription.updateMany({
      where: { id: subscriptionId, userId },
      data: {
        status: PushSubscriptionStatus.REVOKED,
        invalidatedAt: now,
      },
    });

    return result.count > 0;
  }

  static async revokeByToken(userId: string, token: string, now: Date): Promise<boolean> {
    const result = await prisma.pushSubscription.updateMany({
      where: { token, userId },
      data: {
        status: PushSubscriptionStatus.REVOKED,
        invalidatedAt: now,
      },
    });

    return result.count > 0;
  }
}
