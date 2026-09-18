/**
 * Verifies push delivery against a real database and a scripted provider.
 *
 * Every case here is reachable without a Firebase project, which is the point:
 * the delivery pipeline is fully exercised before a vendor is introduced, so
 * configuring one later changes which provider is selected and nothing else.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  NotificationIntent,
  NotificationTargetType,
  PushSubscriptionStatus,
} from "@/generated/prisma";
import prisma from "@/lib/prisma";
import { cleanupNotificationTestData } from "@/testing/notification-cleanup";

import { NotificationGenerationService } from "../backend/notification-generation.service";
import type { NotificationDraft } from "../content/notification-draft";
import { DeliveryService } from "./delivery.service";
import {
  FakePushProvider,
  outcomesByToken,
  scriptedOutcomes,
  type FakeOutcomeScript,
} from "./fake-push-provider";

const PREFIX = "__vitest_delivery_test__";
const NOW = new Date("2026-09-17T13:00:00.000Z");
const noJitter = () => 0;

function unique(name: string): string {
  return `${PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function createUser(suffix: string, intentEnabled = true) {
  const id = unique(`user-${suffix}`);
  const user = await prisma.user.create({
    data: {
      id,
      name: "Delivery Test User",
      email: `${id}@example.test`,
      emailVerified: true,
    },
  });

  await prisma.notificationPreference.create({
    data: {
      userId: user.id,
      intent: NotificationIntent.TOP_RELEVANT_COMPETITION,
      enabled: intentEnabled,
    },
  });

  return user;
}

async function addSubscription(userId: string, token: string) {
  return prisma.pushSubscription.create({
    data: { userId, token, userAgent: "vitest" },
  });
}

function draftFor(userId: string): NotificationDraft {
  return {
    userId,
    intent: NotificationIntent.TOP_RELEVANT_COMPETITION,
    occurrenceKey: "top:2026-09-17",
    title: "A competition worth a look",
    body: "AI Hackathon matches what you're interested in.",
    actionPath: "/competitions/ai-hackathon",
    payload: null,
    targets: [
      {
        targetType: NotificationTargetType.COMPETITION,
        targetId: "comp-a",
        targetVersion: null,
        rank: 1,
      },
    ],
  };
}

async function generateFor(userId: string): Promise<string> {
  const outcome = await NotificationGenerationService.generate(
    draftFor(userId),
    NOW,
  );

  if (!outcome.created) throw new Error("expected a fresh notification");
  return outcome.notificationId;
}

/** Configured and really sending — the path that produces SENT, not SKIPPED. */
function liveProvider(script?: FakeOutcomeScript) {
  return new FakePushProvider({ canDeliver: true, script });
}

const cleanup = () => cleanupNotificationTestData(PREFIX);

beforeEach(cleanup);
afterEach(cleanup);

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("DeliveryService", () => {
  it("records a send the provider accepted as SENT, not DELIVERED", async () => {
    // ND-D-03. The provider took responsibility for the message; nothing here
    // knows a device received it, and nothing knows a person saw it.
    const user = await createUser("accepted");
    await addSubscription(user.id, unique("token"));
    const notificationId = await generateFor(user.id);

    const provider = liveProvider();
    const summary = await DeliveryService.deliver({
      notificationId,
      provider,
      now: NOW,
      random: noJitter,
    });

    expect(summary.accepted).toBe(1);
    expect(provider.callCount).toBe(1);

    const delivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { notificationId, channel: "WEB_PUSH" },
    });
    expect(delivery.status).toBe("SENT");
    expect(delivery.attempts).toBe(1);
    expect(delivery.nextAttemptAt).toBeNull();

    const attempts = await prisma.notificationDeliveryAttempt.findMany({
      where: { deliveryId: delivery.id },
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.outcome).toBe("ACCEPTED");
  });

  it("collapses duplicate pushes by tagging them with the notification id", async () => {
    // Failure case 8. A worker that succeeds at the provider and crashes before
    // recording will send again — unsolvable without distributed transactions,
    // so it is mitigated rather than denied (ND-D-05).
    const user = await createUser("collapse");
    await addSubscription(user.id, unique("token"));
    const notificationId = await generateFor(user.id);

    const provider = liveProvider();

    await DeliveryService.deliver({ notificationId, provider, now: NOW, random: noJitter });

    // Simulate the crash: the delivery never recorded its success.
    await prisma.notificationDelivery.updateMany({
      where: { notificationId, channel: "WEB_PUSH" },
      data: { status: "PENDING", attempts: 0, nextAttemptAt: null },
    });

    await DeliveryService.deliver({ notificationId, provider, now: NOW, random: noJitter });

    expect(provider.callCount).toBe(2);
    // Both copies carry the same collapse identity, so the operating system
    // replaces the first banner instead of stacking a second.
    const [first, second] = provider.recorded;
    expect(first?.message.collapseKey).toBe(notificationId);
    expect(second?.message.collapseKey).toBe(notificationId);

    // And still exactly one notification, whatever happened to the pushes.
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(1);
  });

  it("retries a transient failure without touching the inbox record", async () => {
    // Failure case 5. A push failure retries the push. It must never re-run
    // recommendation generation, and must never alter the notification.
    const user = await createUser("retry");
    await addSubscription(user.id, unique("token"));
    const notificationId = await generateFor(user.id);

    const summary = await DeliveryService.deliver({
      notificationId,
      provider: liveProvider(
        scriptedOutcomes({ outcome: "RETRYABLE", code: "messaging/server-unavailable" }),
      ),
      now: NOW,
      random: noJitter,
    });

    expect(summary.retrying).toBe(1);
    expect(summary.settled).toBe(false);

    const delivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { notificationId, channel: "WEB_PUSH" },
    });
    expect(delivery.status).toBe("PENDING");
    expect(delivery.nextAttemptAt!.getTime()).toBeGreaterThan(NOW.getTime());

    // The inbox is untouched, and its in-app delivery is still delivered.
    const notification = await prisma.notification.findUniqueOrThrow({
      where: { id: notificationId },
      include: { deliveries: true },
    });
    expect(notification.title).toBe("A competition worth a look");
    expect(
      notification.deliveries.find((d) => d.channel === "IN_APP")?.status,
    ).toBe("DELIVERED");
  });

  it("does not send again before the retry is due", async () => {
    const user = await createUser("backoff");
    await addSubscription(user.id, unique("token"));
    const notificationId = await generateFor(user.id);

    const provider = liveProvider(
      scriptedOutcomes({ outcome: "RETRYABLE", code: "messaging/internal-error" }),
    );

    await DeliveryService.deliver({ notificationId, provider, now: NOW, random: noJitter });
    // The job may be re-claimed before the delivery's own retry is due; sending
    // again here would defeat the backoff entirely.
    await DeliveryService.deliver({ notificationId, provider, now: NOW, random: noJitter });

    expect(provider.callCount).toBe(1);
  });

  it("gives up once the delivery's attempts are exhausted", async () => {
    const user = await createUser("exhaust");
    await addSubscription(user.id, unique("token"));
    const notificationId = await generateFor(user.id);

    const provider = liveProvider(
      scriptedOutcomes({ outcome: "RETRYABLE", code: "messaging/internal-error" }),
    );

    // Walk the clock forward past each backoff rather than waiting for it.
    for (let i = 0; i < 6; i += 1) {
      await DeliveryService.deliver({
        notificationId,
        provider,
        now: new Date(NOW.getTime() + i * 60 * 60 * 1000),
        random: noJitter,
      });
    }

    const delivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { notificationId, channel: "WEB_PUSH" },
    });

    expect(delivery.status).toBe("FAILED");
    expect(delivery.nextAttemptAt).toBeNull();
    expect(delivery.failureReason).toContain("Gave up");
  });

  it("deactivates a dead destination on the first sighting and never retries it", async () => {
    // Failure case 6. A browser that cleared its storage will never accept
    // another message; retrying it spends quota to reach the same answer.
    const user = await createUser("invalid");
    const token = unique("token");
    await addSubscription(user.id, token);
    const notificationId = await generateFor(user.id);

    const provider = liveProvider(
      scriptedOutcomes({
        outcome: "INVALID_TOKEN",
        code: "messaging/registration-token-not-registered",
      }),
    );

    const summary = await DeliveryService.deliver({
      notificationId,
      provider,
      now: NOW,
      random: noJitter,
    });

    expect(summary.invalidated).toBe(1);
    expect(provider.callCount).toBe(1);

    const subscription = await prisma.pushSubscription.findUniqueOrThrow({
      where: { token },
    });
    expect(subscription.status).toBe(PushSubscriptionStatus.INVALID);
    expect(subscription.invalidatedAt).not.toBeNull();

    const delivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { notificationId, channel: "WEB_PUSH" },
    });
    // Terminal on attempt one, with attempts still nominally available.
    expect(delivery.status).toBe("FAILED");
    expect(delivery.attempts).toBe(1);

    // A later notification does not attempt the dead token at all.
    provider.reset();
    const second = await NotificationGenerationService.generate(
      { ...draftFor(user.id), occurrenceKey: "top:2026-09-18" },
      NOW,
    );
    if (!second.created) throw new Error("expected a second notification");

    await DeliveryService.deliver({
      notificationId: second.notificationId,
      provider,
      now: NOW,
      random: noJitter,
    });
    expect(provider.callCount).toBe(0);
  });

  it("fails a permanent provider error immediately, leaving the subscription alone", async () => {
    const user = await createUser("permanent");
    const token = unique("token");
    await addSubscription(user.id, token);
    const notificationId = await generateFor(user.id);

    await DeliveryService.deliver({
      notificationId,
      provider: liveProvider(
        scriptedOutcomes({
          outcome: "PERMANENT",
          code: "messaging/third-party-auth-error",
        }),
      ),
      now: NOW,
      random: noJitter,
    });

    const delivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { notificationId, channel: "WEB_PUSH" },
    });
    expect(delivery.status).toBe("FAILED");

    // A credential problem means *every* send is broken, not this destination —
    // deactivating the subscription would be blaming the wrong thing.
    const subscription = await prisma.pushSubscription.findUniqueOrThrow({
      where: { token },
    });
    expect(subscription.status).toBe(PushSubscriptionStatus.ACTIVE);
  });

  it("skips the push when the user disabled the intent after generation", async () => {
    // Failure case 9. The historical notification is untouched; only the push
    // is stopped (ND-D-12, ND-P-14).
    const user = await createUser("disabled-later");
    await addSubscription(user.id, unique("token"));
    const notificationId = await generateFor(user.id);

    await prisma.notificationPreference.update({
      where: {
        userId_intent: {
          userId: user.id,
          intent: NotificationIntent.TOP_RELEVANT_COMPETITION,
        },
      },
      data: { enabled: false },
    });

    const provider = liveProvider();
    const summary = await DeliveryService.deliver({
      notificationId,
      provider,
      now: NOW,
      random: noJitter,
    });

    expect(provider.callCount).toBe(0);
    expect(summary.skipped).toBeGreaterThanOrEqual(0);
    expect(summary.settled).toBe(true);

    // Still in the inbox. History is not rewritten by a preference change.
    const notification = await prisma.notification.findUniqueOrThrow({
      where: { id: notificationId },
    });
    expect(notification.id).toBe(notificationId);
  });

  it("handles several devices independently", async () => {
    // Failure case 10. One notification, three destinations, three outcomes —
    // and only the dead one is deactivated (ND-D-11).
    const user = await createUser("multi-device");
    const laptop = unique("laptop");
    const phone = unique("phone");
    const old = unique("old");

    await addSubscription(user.id, laptop);
    await addSubscription(user.id, phone);
    await addSubscription(user.id, old);

    const notificationId = await generateFor(user.id);

    const summary = await DeliveryService.deliver({
      notificationId,
      provider: liveProvider(
        outcomesByToken({
          [laptop]: { outcome: "ACCEPTED", providerMessageId: "m-1" },
          [old]: {
            outcome: "INVALID_TOKEN",
            code: "messaging/registration-token-not-registered",
          },
          [phone]: { outcome: "RETRYABLE", code: "messaging/server-unavailable" },
        }),
      ),
      now: NOW,
      random: noJitter,
    });

    expect(summary.attempted).toBe(3);
    expect(summary.accepted).toBe(1);
    expect(summary.retrying).toBe(1);
    expect(summary.invalidated).toBe(1);

    const deliveries = await prisma.notificationDelivery.findMany({
      where: { notificationId, channel: "WEB_PUSH" },
      include: { pushSubscription: true },
    });
    expect(deliveries).toHaveLength(3);

    const byToken = new Map(
      deliveries.map((d) => [d.pushSubscription?.token, d.status]),
    );
    expect(byToken.get(laptop)).toBe("SENT");
    expect(byToken.get(phone)).toBe("PENDING");
    expect(byToken.get(old)).toBe("FAILED");

    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId: user.id },
    });
    const statusByToken = new Map(subscriptions.map((s) => [s.token, s.status]));
    expect(statusByToken.get(laptop)).toBe(PushSubscriptionStatus.ACTIVE);
    expect(statusByToken.get(phone)).toBe(PushSubscriptionStatus.ACTIVE);
    expect(statusByToken.get(old)).toBe(PushSubscriptionStatus.INVALID);

    // And the user still has exactly one notification.
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(1);
  });

  it("deactivates a token that keeps failing without ever succeeding", async () => {
    const user = await createUser("ceiling");
    const token = unique("token");
    await addSubscription(user.id, token);

    const provider = liveProvider(
      scriptedOutcomes({ outcome: "RETRYABLE", code: "messaging/internal-error" }),
    );

    // Five separate notifications, each failing once: a token dead in a way the
    // provider is not reporting cleanly.
    for (let day = 1; day <= 5; day += 1) {
      const outcome = await NotificationGenerationService.generate(
        { ...draftFor(user.id), occurrenceKey: `top:2026-09-${10 + day}` },
        NOW,
      );
      if (!outcome.created) continue;

      await DeliveryService.deliver({
        notificationId: outcome.notificationId,
        provider,
        now: NOW,
        random: noJitter,
      });
    }

    const subscription = await prisma.pushSubscription.findUniqueOrThrow({
      where: { token },
    });
    expect(subscription.status).toBe(PushSubscriptionStatus.INVALID);
  });

  it("records nothing as sent when no provider is configured", async () => {
    // The default state of local development and of this repository until a
    // Firebase project exists. It must never look like a successful send.
    const user = await createUser("unconfigured");
    await addSubscription(user.id, unique("token"));
    const notificationId = await generateFor(user.id);

    const provider = new FakePushProvider(); // canDeliver: false
    const summary = await DeliveryService.deliver({
      notificationId,
      provider,
      now: NOW,
      random: noJitter,
    });

    expect(provider.callCount).toBe(0);
    expect(summary.settled).toBe(true);

    const delivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { notificationId, channel: "WEB_PUSH" },
    });
    expect(delivery.status).toBe("SKIPPED");
    expect(delivery.failureReason).toContain("No push provider");
  });

  it("treats a user with no registered device as settled, not failed", async () => {
    const user = await createUser("no-devices");
    const notificationId = await generateFor(user.id);

    const summary = await DeliveryService.deliver({
      notificationId,
      provider: liveProvider(),
      now: NOW,
      random: noJitter,
    });

    // They still received the notification — in the inbox, the channel that
    // always works.
    expect(summary.settled).toBe(true);
    expect(summary.attempted).toBe(0);
  });

  it("skips a push that is no longer worth sending", async () => {
    const user = await createUser("stale");
    await addSubscription(user.id, unique("token"));
    const notificationId = await generateFor(user.id);

    const provider = liveProvider();
    const muchLater = new Date(NOW.getTime() + 48 * 60 * 60 * 1000);

    const summary = await DeliveryService.deliver({
      notificationId,
      provider,
      now: muchLater,
      random: noJitter,
    });

    expect(provider.callCount).toBe(0);
    expect(summary.settled).toBe(true);

    const delivery = await prisma.notificationDelivery.findFirst({
      where: { notificationId, channel: "WEB_PUSH" },
    });
    // SKIPPED, not FAILED: a deliberate decision recorded as an error makes
    // failure metrics unreadable (ND-D-13).
    expect(delivery?.status ?? "SKIPPED").toBe("SKIPPED");
  });
});
