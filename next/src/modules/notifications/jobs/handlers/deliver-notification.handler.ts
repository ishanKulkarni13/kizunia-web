/**
 * Job handler — push one notification to the user's devices.
 *
 * Thin by design. The interesting decisions are in `DeliveryService`; what this
 * file owns is the translation between "a delivery still needs retrying" and
 * "this job is not finished", which is the seam where the two retry mechanisms
 * meet.
 *
 * ## Two retry loops, one outcome
 *
 * Deliveries carry their own attempt counts and backoff, per device. Jobs carry
 * theirs. They are not the same thing — a user with three browsers has three
 * independent delivery states behind one job — so the job's rule is simply:
 * finish when nothing is left to retry, and throw when something is.
 *
 * Throwing is what puts the job back in the queue with the runner's backoff.
 * The delivery's own `nextAttemptAt` is the finer-grained schedule; the job is
 * the thing that wakes up to honour it.
 */
import type { NotificationJobKind } from "@/generated/prisma";

import { DeliveryService } from "../../delivery/delivery.service";
import { getPushProvider } from "../../delivery/push-provider.factory";
import { completed, type JobHandler } from "../handler";

export const deliverNotificationHandler: JobHandler<
  typeof NotificationJobKind.DELIVER_NOTIFICATION
> = async ({ payload, now }) => {
  const summary = await DeliveryService.deliver({
    notificationId: payload.notificationId,
    provider: getPushProvider(),
    now,
  });

  if (summary.settled) {
    return completed(
      `accepted:${summary.accepted} failed:${summary.failed} skipped:${summary.skipped}`,
    );
  }

  // Something is waiting on a retry. Throwing hands the job back to the runner,
  // which applies its own backoff and re-claims it later — at which point the
  // delivery service re-reads each delivery's state and only re-sends the ones
  // that are actually due.
  //
  // A plain Error, deliberately: this is transient by construction, and
  // classifying it as anything else would strand deliveries that were only ever
  // waiting.
  throw new Error(
    `${summary.retrying} push deliver${summary.retrying === 1 ? "y" : "ies"} awaiting retry`,
  );
};
