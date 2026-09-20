/**
 * Notifications — Push Delivery
 *
 * Business Layer
 *
 * Takes a notification that already exists and tries to get it onto the user's
 * devices.
 *
 * Responsibilities
 * ----------------
 * ✓ Re-check the user's preference immediately before sending
 * ✓ Fan out to every active subscription, one delivery record each
 * ✓ Classify each outcome, schedule retries, deactivate dead destinations
 * ✓ Record every attempt
 *
 * Does NOT
 * ----------------
 * ✗ Decide whether the notification should exist — that already happened
 * ✗ Create, alter or delete the notification. A delivery failure must never
 *   touch the inbox record (ND-D-01)
 * ✗ Know which provider it is talking to
 *
 * ## The boundary this file defends
 *
 * A push failing is not a recommendation failing. When FCM is down, the correct
 * response is to retry the *push* — not to re-run the engine, which would redo
 * the most expensive step in the pipeline to fix a transport problem, and could
 * re-derive a different decision from the one the user was already shown.
 */
import {
  NotificationDeliveryStatus,
  type NotificationIntent,
} from "@/generated/prisma";
import { NotificationPreferenceService } from "@/modules/preferences/backend/notification-preference.service";

import { DELIVERY_CONFIG } from "../config/notification-config";
import { nextAttemptAt, type BackoffPolicy } from "../jobs/backoff";
import { logNotificationEvent } from "../observability/log";
import { DeliveryRepository } from "./delivery.repository";
import type { PushProvider, PushSendResult } from "./push-provider.port";

const PUSH_BACKOFF: BackoffPolicy = {
  baseSeconds: DELIVERY_CONFIG.pushBackoffBaseSeconds,
  factor: DELIVERY_CONFIG.pushBackoffFactor,
  capSeconds: DELIVERY_CONFIG.pushBackoffCapSeconds,
  jitterRatio: DELIVERY_CONFIG.pushJitterRatio,
};

export interface DeliverInput {
  readonly notificationId: string;
  readonly provider: PushProvider;
  readonly now: Date;
  readonly random?: () => number;
}

export interface DeliverySummary {
  readonly attempted: number;
  readonly accepted: number;
  readonly retrying: number;
  readonly failed: number;
  readonly skipped: number;
  readonly invalidated: number;
  /** True once nothing is left to retry, so the job may complete. */
  readonly settled: boolean;
}

const NOTHING: DeliverySummary = {
  attempted: 0,
  accepted: 0,
  retrying: 0,
  failed: 0,
  skipped: 0,
  invalidated: 0,
  settled: true,
};

export class DeliveryService {
  static async deliver(input: DeliverInput): Promise<DeliverySummary> {
    const { notificationId, provider, now } = input;
    const random = input.random ?? Math.random;

    const notification = await DeliveryRepository.findForDelivery(notificationId);

    if (!notification) {
      // The notification is gone. Nothing to deliver and nothing to retry —
      // reporting this as settled lets the job complete rather than retrying
      // its way to the same conclusion.
      logNotificationEvent("delivery.notification_missing", { notificationId });
      return NOTHING;
    }

    // Re-checked here, not trusted from generation time (ND-D-12). Pushing to
    // someone who switched the setting off five minutes ago is the clearest
    // possible evidence that the setting does not work.
    const stillWanted = await this.intentStillEnabled(
      notification.userId,
      notification.intent,
    );

    if (!stillWanted) {
      const skipped = await DeliveryRepository.skipPending({
        notificationId,
        now,
        reason: "Intent disabled by the user after this notification was created",
      });

      logNotificationEvent("delivery.skipped", {
        notificationId,
        reason: "INTENT_DISABLED",
        deliveries: skipped,
      });

      // The notification itself stays in the inbox. It is history, and history
      // is not rewritten (ND-H-02, ND-P-14).
      return { ...NOTHING, skipped };
    }

    // Stale pushes are skipped rather than failed (ND-D-13): a reminder about a
    // deadline two days out has no value hours late, the inbox already carries
    // it, and recording a deliberate decision as an error makes failure metrics
    // unreadable.
    const ageSeconds = (now.getTime() - notification.createdAt.getTime()) / 1000;
    if (ageSeconds > DELIVERY_CONFIG.pushValidForSeconds) {
      const skipped = await DeliveryRepository.skipPending({
        notificationId,
        now,
        reason: "Too old to be worth pushing",
      });

      logNotificationEvent("delivery.skipped", {
        notificationId,
        reason: "STALE",
        ageSeconds: Math.round(ageSeconds),
        deliveries: skipped,
      });

      return { ...NOTHING, skipped };
    }

    const subscriptions = await DeliveryRepository.findActiveSubscriptions(
      notification.userId,
      DELIVERY_CONFIG.maxSubscriptionsPerUser,
    );

    if (subscriptions.length === 0) {
      // Not a failure. A user with no registered browser still received the
      // notification — in the inbox, which is the channel that always works.
      logNotificationEvent("delivery.no_subscriptions", {
        notificationId,
        userId: notification.userId,
      });

      return NOTHING;
    }

    if (!provider.canDeliver) {
      const skipped = await this.skipUndeliverable(
        notificationId,
        subscriptions.map((s) => s.id),
        now,
      );

      logNotificationEvent("delivery.provider_unconfigured", {
        notificationId,
        provider: provider.id,
        subscriptions: subscriptions.length,
      });

      return { ...NOTHING, skipped };
    }

    let accepted = 0;
    let retrying = 0;
    let failed = 0;
    let invalidated = 0;

    for (const subscription of subscriptions) {
      // Each device is independent (ND-D-11). One dead token must not stop the
      // user's other browsers from being reached.
      const result = await this.deliverToSubscription({
        notification,
        subscription,
        provider,
        now,
        random,
      });

      if (result === "ACCEPTED") accepted += 1;
      else if (result === "RETRYING") retrying += 1;
      else {
        failed += 1;
        if (result === "INVALIDATED") invalidated += 1;
      }
    }

    const summary: DeliverySummary = {
      attempted: subscriptions.length,
      accepted,
      retrying,
      failed,
      skipped: 0,
      invalidated,
      settled: retrying === 0,
    };

    logNotificationEvent("delivery.pass", { notificationId, ...summary });

    return summary;
  }

  private static async intentStillEnabled(
    userId: string,
    intent: NotificationIntent,
  ): Promise<boolean> {
    return NotificationPreferenceService.isEnabledForUser(userId, intent);
  }

  private static async skipUndeliverable(
    notificationId: string,
    subscriptionIds: readonly string[],
    now: Date,
  ): Promise<number> {
    let skipped = 0;

    for (const subscriptionId of subscriptionIds) {
      const delivery = await DeliveryRepository.ensurePushDelivery({
        notificationId,
        subscriptionId,
        maxAttempts: DELIVERY_CONFIG.pushMaxAttempts,
      });

      await DeliveryRepository.settle({
        deliveryId: delivery.id,
        status: NotificationDeliveryStatus.SKIPPED,
        now,
        failureReason: "No push provider is configured in this environment",
      });

      skipped += 1;
    }

    return skipped;
  }

  private static async deliverToSubscription(input: {
    notification: Awaited<ReturnType<typeof DeliveryRepository.findForDelivery>>;
    subscription: { id: string; token: string };
    provider: PushProvider;
    now: Date;
    random: () => number;
  }): Promise<"ACCEPTED" | "RETRYING" | "FAILED" | "INVALIDATED"> {
    const { notification, subscription, provider, now, random } = input;
    if (!notification) return "FAILED";

    const delivery = await DeliveryRepository.ensurePushDelivery({
      notificationId: notification.id,
      subscriptionId: subscription.id,
      maxAttempts: DELIVERY_CONFIG.pushMaxAttempts,
    });

    // Already resolved by an earlier pass. Re-sending would mean a duplicate
    // push for no reason — this is the cheap half of the at-least-once story,
    // narrowing the window rather than pretending to close it.
    if (
      delivery.status === NotificationDeliveryStatus.SENT ||
      delivery.status === NotificationDeliveryStatus.FAILED ||
      delivery.status === NotificationDeliveryStatus.SKIPPED
    ) {
      return delivery.status === NotificationDeliveryStatus.SENT
        ? "ACCEPTED"
        : "FAILED";
    }

    // Backing off. The job may well be re-claimed before this delivery's own
    // retry is due — the two schedules are independent — so honour the
    // delivery's clock rather than sending again the moment a worker looks at
    // it, which would defeat the backoff entirely.
    if (delivery.nextAttemptAt && delivery.nextAttemptAt > now) {
      return "RETRYING";
    }

    const attemptNumber = delivery.attempts + 1;

    const attempt = await DeliveryRepository.startAttempt({
      deliveryId: delivery.id,
      attemptNumber,
      now,
      provider: provider.id,
    });

    let result: PushSendResult;

    try {
      result = await provider.send({
        token: subscription.token,
        title: notification.title,
        body: notification.body,
        link: notification.actionPath,
        // Same identity for every copy of this notification, so a duplicate
        // send replaces the earlier banner instead of stacking (ND-D-05).
        collapseKey: notification.id,
        data: { notificationId: notification.id, intent: notification.intent },
      });
    } catch (error) {
      // A provider that throws is a provider that is unusable, not a message
      // that was rejected. Retryable by definition.
      result = {
        outcome: "RETRYABLE",
        code: "PROVIDER_THREW",
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    await DeliveryRepository.finishAttempt({
      attemptId: attempt?.id ?? null,
      now,
      outcome: result.outcome,
      errorCode: result.outcome === "ACCEPTED" ? null : result.code,
      providerResponse: result,
    });

    return this.applyOutcome({
      deliveryId: delivery.id,
      subscriptionId: subscription.id,
      attemptNumber,
      maxAttempts: delivery.maxAttempts,
      result,
      now,
      random,
      providerId: provider.id,
    });
  }

  private static async applyOutcome(input: {
    deliveryId: string;
    subscriptionId: string;
    attemptNumber: number;
    maxAttempts: number;
    result: PushSendResult;
    now: Date;
    random: () => number;
    providerId: string;
  }): Promise<"ACCEPTED" | "RETRYING" | "FAILED" | "INVALIDATED"> {
    const { deliveryId, subscriptionId, result, now } = input;

    if (result.outcome === "ACCEPTED") {
      await DeliveryRepository.settle({
        deliveryId,
        // SENT, not DELIVERED. The provider accepted responsibility for the
        // message; nothing here knows whether a device received it, and
        // nothing knows whether a person saw it (ND-D-03).
        status: NotificationDeliveryStatus.SENT,
        now,
        providerMessageId: result.providerMessageId,
      });

      await DeliveryRepository.recordSubscriptionSuccess(subscriptionId, now);

      return "ACCEPTED";
    }

    if (result.outcome === "INVALID_TOKEN") {
      // Terminal on the first sighting (ND-D-09). A browser that cleared its
      // storage or revoked permission will never accept another message, and
      // retrying it spends quota to reach the same answer.
      await DeliveryRepository.settle({
        deliveryId,
        status: NotificationDeliveryStatus.FAILED,
        now,
        failureReason: `Push destination is no longer valid (${result.code})`,
      });

      await DeliveryRepository.invalidateSubscription(subscriptionId, now);

      logNotificationEvent("delivery.subscription_invalidated", {
        subscriptionId,
        code: result.code,
      });

      return "INVALIDATED";
    }

    if (result.outcome === "PERMANENT") {
      await DeliveryRepository.settle({
        deliveryId,
        status: NotificationDeliveryStatus.FAILED,
        now,
        failureReason: `Permanent provider error (${result.code})`,
      });

      return "FAILED";
    }

    // Retryable from here.
    const exhausted = input.attemptNumber >= input.maxAttempts;

    if (exhausted) {
      await DeliveryRepository.settle({
        deliveryId,
        status: NotificationDeliveryStatus.FAILED,
        now,
        failureReason: `Gave up after ${input.attemptNumber} attempts (${result.code})`,
      });

      return "FAILED";
    }

    const retryAt = nextAttemptAt(now, input.attemptNumber, PUSH_BACKOFF, input.random);

    await DeliveryRepository.scheduleRetry({
      deliveryId,
      now,
      nextAttemptAt: retryAt,
      failureReason: `Retrying after ${result.code}`,
    });

    const consecutive = await DeliveryRepository.recordSubscriptionFailure(
      subscriptionId,
    );

    // A token failing repeatedly without ever succeeding is dead in a way the
    // provider is not reporting cleanly. Deactivate it defensively rather than
    // keep paying for it.
    if (consecutive >= DELIVERY_CONFIG.consecutiveFailureCeiling) {
      await DeliveryRepository.invalidateSubscription(subscriptionId, now);

      logNotificationEvent("delivery.subscription_invalidated", {
        subscriptionId,
        code: "CONSECUTIVE_FAILURES",
        consecutive,
      });
    }

    return "RETRYING";
  }
}
