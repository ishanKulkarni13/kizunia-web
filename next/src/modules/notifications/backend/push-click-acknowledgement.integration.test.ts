/**
 * What a push click asks of the server (#93).
 *
 * The service worker calls the same `markResponded` / `markRead` the inbox
 * uses, so these tests are about the properties that call needs when it comes
 * from a banner rather than a button: it can arrive twice, it can arrive for a
 * notification already read in another tab, and it can be aimed at someone
 * else's id.
 *
 * Nothing here is specific to an intent. That is the point — the mechanism is
 * keyed on the notification's identity, so every producer gets it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { NotificationIntent } from "@/generated/prisma";
import prisma from "@/lib/prisma";
import { cleanupNotificationTestData } from "@/testing/notification-cleanup";

import { NotificationService } from "./notification.service";

const PREFIX = "__vitest_push_click_test__";

function unique(name: string): string {
  return `${PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function createUser(suffix: string) {
  const id = unique(`user-${suffix}`);
  return prisma.user.create({
    data: {
      id,
      name: "Push Click Test User",
      email: `${id}@example.test`,
      emailVerified: true,
    },
  });
}

async function createNotification(
  userId: string,
  intent: NotificationIntent = NotificationIntent.TOP_RELEVANT_COMPETITION,
  actionPath: string | null = "/competitions/example",
) {
  return prisma.notification.create({
    data: {
      userId,
      intent,
      occurrenceKey: unique("occurrence"),
      title: "Title",
      body: "Body",
      actionPath,
    },
  });
}

async function load(id: string) {
  return prisma.notification.findUniqueOrThrow({ where: { id } });
}

beforeAll(() => cleanupNotificationTestData(PREFIX));
afterEach(() => cleanupNotificationTestData(PREFIX));
afterAll(async () => {
  await cleanupNotificationTestData(PREFIX);
  await prisma.$disconnect();
});

describe("acknowledging a notification from a push click", () => {
  it("marks it responded, and read with it — as opening it from the inbox does", async () => {
    const user = await createUser("fresh");
    const notification = await createNotification(user.id);

    await NotificationService.markResponded(user.id, notification.id);

    const after = await load(notification.id);
    expect(after.respondedAt).not.toBeNull();
    expect(after.readAt).not.toBeNull();
    expect((await NotificationService.getInbox({ userId: user.id })).unreadCount).toBe(0);
  });

  it("is safe to repeat: a second click moves neither timestamp", async () => {
    const user = await createUser("repeat");
    const notification = await createNotification(user.id);

    await NotificationService.markResponded(user.id, notification.id);
    const first = await load(notification.id);

    await NotificationService.markResponded(user.id, notification.id);
    const second = await load(notification.id);

    expect(second.respondedAt).toEqual(first.respondedAt);
    expect(second.readAt).toEqual(first.readAt);
  });

  it("keeps the original read time when the notification was already read", async () => {
    const user = await createUser("already-read");
    const notification = await createNotification(user.id);

    await NotificationService.markRead(user.id, notification.id);
    const read = await load(notification.id);

    await NotificationService.markResponded(user.id, notification.id);
    const after = await load(notification.id);

    expect(after.readAt).toEqual(read.readAt);
    expect(after.respondedAt).not.toBeNull();
  });

  it("leaves a notification already responded to exactly as it was when read arrives later", async () => {
    // The no-action fallback path acknowledges with `read`, and a click can
    // race a click from another device.
    const user = await createUser("read-after");
    const notification = await createNotification(user.id);

    await NotificationService.markResponded(user.id, notification.id);
    const responded = await load(notification.id);

    await NotificationService.markRead(user.id, notification.id);
    const after = await load(notification.id);

    expect(after.readAt).toEqual(responded.readAt);
    expect(after.respondedAt).toEqual(responded.respondedAt);
  });

  it("marks a notification with no action read without claiming a response", async () => {
    const user = await createUser("no-action");
    const notification = await createNotification(
      user.id,
      NotificationIntent.FEATURE_ANNOUNCEMENT,
      null,
    );

    await NotificationService.markRead(user.id, notification.id);

    const after = await load(notification.id);
    expect(after.readAt).not.toBeNull();
    expect(after.respondedAt).toBeNull();
  });

  it("touches only the notification it was given", async () => {
    const user = await createUser("exact");
    const clicked = await createNotification(user.id);
    const sibling = await createNotification(user.id);

    await NotificationService.markResponded(user.id, clicked.id);

    const untouched = await load(sibling.id);
    expect(untouched.readAt).toBeNull();
    expect(untouched.respondedAt).toBeNull();
  });

  it.each([
    NotificationIntent.TOP_RELEVANT_COMPETITION,
    NotificationIntent.REGISTRATION_CLOSING,
    NotificationIntent.ADMIN_COMPETITION_SUGGESTION,
    NotificationIntent.FEATURE_ANNOUNCEMENT,
  ])("works the same for a %s notification", async (intent) => {
    const user = await createUser(`intent-${intent.toLowerCase()}`);
    const notification = await createNotification(user.id, intent);

    await NotificationService.markResponded(user.id, notification.id);

    const after = await load(notification.id);
    expect(after.respondedAt).not.toBeNull();
    expect(after.readAt).not.toBeNull();
  });
});

describe("acknowledging someone else's notification", () => {
  it.each([
    ["responded", (userId: string, id: string) => NotificationService.markResponded(userId, id)],
    ["read", (userId: string, id: string) => NotificationService.markRead(userId, id)],
  ] as const)("refuses to mark it %s, and changes nothing", async (_kind, acknowledge) => {
    const owner = await createUser("owner");
    const stranger = await createUser("stranger");
    const notification = await createNotification(owner.id);

    // 404, not 403: the id is not a fact the stranger may have confirmed.
    await expect(acknowledge(stranger.id, notification.id)).rejects.toThrow(
      /not found/i,
    );

    const after = await load(notification.id);
    expect(after.readAt).toBeNull();
    expect(after.respondedAt).toBeNull();
  });

  it("answers an unknown id exactly as it answers someone else's", async () => {
    const stranger = await createUser("nobody");

    await expect(
      NotificationService.markResponded(stranger.id, "does-not-exist"),
    ).rejects.toThrow(/not found/i);
  });
});
