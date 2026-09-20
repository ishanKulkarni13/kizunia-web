/**
 * Notifications — Delivery Repository
 *
 * Database Layer
 *
 * Responsibilities
 * ----------------
 * ✓ Build and execute the delivery, attempt and subscription queries
 *
 * Does NOT
 * ----------------
 * ✗ Business rules  ✗ Validation  ✗ Authentication  ✗ Authorization
 * ✗ Decide what an outcome means — that is the delivery service's job
 */
import {
  NotificationDeliveryStatus,
  Prisma,
  PushSubscriptionStatus,
  type NotificationDeliveryOutcome,
} from "@/generated/prisma";
import prisma from "@/lib/prisma";

const UNIQUE_VIOLATION = "P2002";

export class DeliveryRepository {
  /** Just enough of the notification to build a push out of. */
  static async findForDelivery(notificationId: string) {
    return prisma.notification.findUnique({
      where: { id: notificationId },
      select: {
        id: true,
        userId: true,
        intent: true,
        title: true,
        body: true,
        actionPath: true,
        createdAt: true,
      },
    });
  }

  /**
   * Destinations worth attempting.
   *
   * Invalid and revoked subscriptions are excluded here rather than skipped
   * later, so a dead token costs nothing at all rather than costing a delivery
   * record and an attempt every time.
   */
  static async findActiveSubscriptions(userId: string, take: number) {
    return prisma.pushSubscription.findMany({
      where: { userId, status: PushSubscriptionStatus.ACTIVE },
      select: { id: true, token: true },
      orderBy: { lastSeenAt: "desc" },
      take,
    });
  }

  /**
   * The delivery record for one notification on one device, creating it if this
   * is the first attempt.
   *
   * Created on first use rather than upfront at generation time: the set of a
   * user's devices can change between generation and delivery, and a row per
   * device created in advance would be wrong for exactly the user who adds a
   * browser in between.
   */
  static async ensurePushDelivery(input: {
    notificationId: string;
    subscriptionId: string;
    maxAttempts: number;
  }) {
    const existing = await prisma.notificationDelivery.findFirst({
      where: {
        notificationId: input.notificationId,
        channel: "WEB_PUSH",
        pushSubscriptionId: input.subscriptionId,
      },
    });

    if (existing) return existing;

    try {
      return await prisma.notificationDelivery.create({
        data: {
          notificationId: input.notificationId,
          channel: "WEB_PUSH",
          status: NotificationDeliveryStatus.PENDING,
          maxAttempts: input.maxAttempts,
          pushSubscriptionId: input.subscriptionId,
          provider: "FCM",
        },
      });
    } catch (error) {
      // Another execution created it between the read and the write. Both
      // wanted the same row to exist, so re-reading is the right resolution.
      if (isUniqueViolation(error)) {
        return prisma.notificationDelivery.findFirstOrThrow({
          where: {
            notificationId: input.notificationId,
            channel: "WEB_PUSH",
            pushSubscriptionId: input.subscriptionId,
          },
        });
      }

      throw error;
    }
  }

  /**
   * Opens an attempt record and counts the attempt on the delivery.
   *
   * The count moves *before* the send, for the same reason job attempts are
   * consumed at claim time: a crash between sending and recording must still
   * have cost an attempt, or the delivery retries forever.
   */
  static async startAttempt(input: {
    deliveryId: string;
    attemptNumber: number;
    now: Date;
    provider: string;
  }) {
    await prisma.notificationDelivery.update({
      where: { id: input.deliveryId },
      data: {
        status: NotificationDeliveryStatus.PROCESSING,
        attempts: input.attemptNumber,
        lastAttemptAt: input.now,
      },
    });

    try {
      return await prisma.notificationDeliveryAttempt.create({
        data: {
          deliveryId: input.deliveryId,
          attemptNumber: input.attemptNumber,
          startedAt: input.now,
        },
      });
    } catch (error) {
      // A duplicate attempt number means this attempt was already logged by an
      // execution that then died. Losing the audit row is not worth failing the
      // delivery over.
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  static async finishAttempt(input: {
    attemptId: string | null;
    now: Date;
    outcome: NotificationDeliveryOutcome;
    errorCode: string | null;
    providerResponse: unknown;
  }): Promise<void> {
    if (!input.attemptId) return;

    await prisma.notificationDeliveryAttempt.update({
      where: { id: input.attemptId },
      data: {
        finishedAt: input.now,
        outcome: input.outcome,
        errorCode: input.errorCode,
        providerResponse: input.providerResponse as Prisma.InputJsonValue,
      },
    });
  }

  /** Moves a delivery to a terminal state. */
  static async settle(input: {
    deliveryId: string;
    status: NotificationDeliveryStatus;
    now: Date;
    failureReason?: string;
    providerMessageId?: string | null;
  }): Promise<void> {
    await prisma.notificationDelivery.update({
      where: { id: input.deliveryId },
      data: {
        status: input.status,
        lastAttemptAt: input.now,
        // Cleared, so nothing reads as "waiting for a retry" once it is done.
        nextAttemptAt: null,
        failureReason: input.failureReason ?? null,
        providerMessageId: input.providerMessageId ?? undefined,
      },
    });
  }

  static async scheduleRetry(input: {
    deliveryId: string;
    now: Date;
    nextAttemptAt: Date;
    failureReason: string;
  }): Promise<void> {
    await prisma.notificationDelivery.update({
      where: { id: input.deliveryId },
      data: {
        status: NotificationDeliveryStatus.PENDING,
        lastAttemptAt: input.now,
        nextAttemptAt: input.nextAttemptAt,
        failureReason: input.failureReason,
      },
    });
  }

  /** Marks every unfinished delivery for a notification as deliberately skipped. */
  static async skipPending(input: {
    notificationId: string;
    now: Date;
    reason: string;
  }): Promise<number> {
    const result = await prisma.notificationDelivery.updateMany({
      where: {
        notificationId: input.notificationId,
        channel: "WEB_PUSH",
        status: {
          in: [
            NotificationDeliveryStatus.PENDING,
            NotificationDeliveryStatus.PROCESSING,
          ],
        },
      },
      data: {
        status: NotificationDeliveryStatus.SKIPPED,
        nextAttemptAt: null,
        failureReason: input.reason,
        lastAttemptAt: input.now,
      },
    });

    return result.count;
  }

  static async recordSubscriptionSuccess(
    subscriptionId: string,
    now: Date,
  ): Promise<void> {
    await prisma.pushSubscription.update({
      where: { id: subscriptionId },
      data: { consecutiveFailures: 0, lastSuccessAt: now, lastSeenAt: now },
    });
  }

  /** Increments and returns the new consecutive-failure count. */
  static async recordSubscriptionFailure(subscriptionId: string): Promise<number> {
    const updated = await prisma.pushSubscription.update({
      where: { id: subscriptionId },
      data: { consecutiveFailures: { increment: 1 } },
      select: { consecutiveFailures: true },
    });

    return updated.consecutiveFailures;
  }

  static async invalidateSubscription(
    subscriptionId: string,
    now: Date,
  ): Promise<void> {
    await prisma.pushSubscription.update({
      where: { id: subscriptionId },
      data: {
        status: PushSubscriptionStatus.INVALID,
        invalidatedAt: now,
      },
    });
  }

  /** Deliveries waiting on a retry whose time has come. */
  static async findDueRetries(now: Date, take: number) {
    return prisma.notificationDelivery.findMany({
      where: {
        channel: "WEB_PUSH",
        status: NotificationDeliveryStatus.PENDING,
        nextAttemptAt: { lte: now },
      },
      select: { notificationId: true },
      distinct: ["notificationId"],
      take,
    });
  }

  /**
   * Deletes delivery-attempt audit rows older than `before`, up to `limit`.
   *
   * Attempts are per-send forensic detail, not state: dedup reads
   * `NotificationDelivery.status` (`NotificationRepository.findDeliveredTargetIds`),
   * never this table. Deleting old rows only loses "what did the provider say
   * on attempt N", never delivery or dedup correctness.
   *
   * Two statements rather than one `deleteMany`, matching `WorkQueue.prune`:
   * Prisma cannot put a `LIMIT` on a delete, and an unbounded delete over a
   * large backlog is exactly the long-running statement a prune pass must
   * avoid.
   *
   * Keyed on `startedAt`, not `finishedAt` — an attempt that crashed mid-send
   * has no `finishedAt` and must still age out.
   */
  static async pruneAttempts(before: Date, limit: number): Promise<number> {
    const doomed = await prisma.notificationDeliveryAttempt.findMany({
      where: { startedAt: { lt: before } },
      select: { id: true },
      take: limit,
    });

    if (doomed.length === 0) return 0;

    const result = await prisma.notificationDeliveryAttempt.deleteMany({
      where: { id: { in: doomed.map((attempt) => attempt.id) } },
    });

    return result.count;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_VIOLATION
  );
}
