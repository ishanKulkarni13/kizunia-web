/**
 * Verifies that generating a notification is atomic and idempotent.
 *
 * These two properties are what stand between the design and its two worst
 * silent failures: an inbox row nobody will ever deliver, and a user told the
 * same thing twice because a scheduler ran twice.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  NotificationIntent,
  NotificationTargetType,
} from "@/generated/prisma";
import prisma from "@/lib/prisma";
import { cleanupNotificationTestData } from "@/testing/notification-cleanup";

import type { NotificationDraft } from "../content/notification-draft";
import { NotificationGenerationService } from "./notification-generation.service";

const PREFIX = "__vitest_generation_test__";

function unique(name: string): string {
  return `${PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function createTestUser(suffix: string) {
  const id = unique(`user-${suffix}`);
  return prisma.user.create({
    data: {
      id,
      name: "Generation Test User",
      email: `${id}@example.test`,
      emailVerified: true,
    },
  });
}

function draftFor(
  userId: string,
  overrides: Partial<NotificationDraft> = {},
): NotificationDraft {
  return {
    userId,
    intent: NotificationIntent.TOP_RELEVANT_COMPETITION,
    occurrenceKey: "top:2026-09-17",
    title: "A competition worth a look",
    body: "AI Hackathon matches what you're interested in.",
    actionPath: "/competitions/ai-hackathon",
    payload: { competitions: [{ id: "comp-a", slug: "ai-hackathon" }] },
    targets: [
      {
        targetType: NotificationTargetType.COMPETITION,
        targetId: "comp-a",
        targetVersion: null,
        rank: 1,
      },
    ],
    ...overrides,
  };
}

const cleanup = () => cleanupNotificationTestData(PREFIX);

afterEach(cleanup);

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

const NOW = new Date("2026-09-17T13:00:00.000Z");

describe("NotificationGenerationService", () => {
  it("creates the notification, its targets, its in-app delivery and its delivery job together", async () => {
    const user = await createTestUser("happy");

    const outcome = await NotificationGenerationService.generate(
      draftFor(user.id),
      NOW,
    );

    expect(outcome.created).toBe(true);

    const notification = await prisma.notification.findFirstOrThrow({
      where: { userId: user.id },
      include: { targets: true, deliveries: true },
    });

    expect(notification.title).toBe("A competition worth a look");
    expect(notification.actionPath).toBe("/competitions/ai-hackathon");
    expect(notification.readAt).toBeNull();
    expect(notification.respondedAt).toBeNull();

    expect(notification.targets).toHaveLength(1);
    expect(notification.targets[0]?.targetId).toBe("comp-a");
    // Denormalised onto the target so deduplication needs no join.
    expect(notification.targets[0]?.userId).toBe(user.id);

    // In-app is delivered at persistence: the row being visible IS the
    // delivery, and there is no later event to wait for (ND-D-04).
    const inApp = notification.deliveries.find((d) => d.channel === "IN_APP");
    expect(inApp?.status).toBe("DELIVERED");

    const job = await prisma.notificationJob.findFirstOrThrow({
      where: { kind: "DELIVER_NOTIFICATION", payload: { path: ["notificationId"], equals: notification.id } },
    });
    expect(job.status).toBe("PENDING");
  });

  it("treats a repeated occurrence as already done rather than as an error", async () => {
    // Failure case 3. The guarantee is the unique constraint, not a prior read:
    // two concurrent schedulers would both pass an existence check.
    const user = await createTestUser("idempotent");

    const first = await NotificationGenerationService.generate(
      draftFor(user.id),
      NOW,
    );
    const second = await NotificationGenerationService.generate(
      draftFor(user.id),
      NOW,
    );

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);

    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(1);
  });

  it("allows a different occasion on a later day", async () => {
    const user = await createTestUser("next-day");

    await NotificationGenerationService.generate(draftFor(user.id), NOW);
    await NotificationGenerationService.generate(
      draftFor(user.id, { occurrenceKey: "top:2026-09-18" }),
      new Date("2026-09-18T13:00:00.000Z"),
    );

    // History is a log, not a current-state row: yesterday's notification stays
    // exactly as it was (ND-H-02).
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(2);
  });

  it("keeps two intents independent on the same day", async () => {
    // ND-H-07. A discovery notification must not suppress a deadline one.
    const user = await createTestUser("two-intents");

    await NotificationGenerationService.generate(draftFor(user.id), NOW);
    await NotificationGenerationService.generate(
      draftFor(user.id, {
        intent: NotificationIntent.REGISTRATION_CLOSING,
        occurrenceKey: "closing:2026-09-17",
      }),
      NOW,
    );

    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(2);
  });

  it("leaves nothing behind when the write fails partway", async () => {
    // Failure case 7, and the reason everything is in one transaction. The
    // alternative outcomes are both silent: an inbox row nobody delivers, or a
    // delivery job pointing at a row that does not exist.
    const user = await createTestUser("atomic");

    // Two targets with the same identity violate the target uniqueness
    // constraint *after* the notification row has been written, so the failure
    // lands mid-transaction — exactly the shape being guarded against.
    const doomed = draftFor(user.id, {
      targets: [
        {
          targetType: NotificationTargetType.COMPETITION,
          targetId: "comp-dup",
          targetVersion: null,
          rank: 1,
        },
        {
          targetType: NotificationTargetType.COMPETITION,
          targetId: "comp-dup",
          targetVersion: null,
          rank: 2,
        },
      ],
    });

    await expect(
      NotificationGenerationService.generate(doomed, NOW),
    ).rejects.toThrow();

    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(0);
    expect(
      await prisma.notificationTarget.count({ where: { userId: user.id } }),
    ).toBe(0);
    expect(
      await prisma.notificationJob.count({
        where: { dedupeKey: { contains: PREFIX } },
      }),
    ).toBe(0);
  });

  it("stores several subjects for an aggregated notification", async () => {
    // ND-H-11: one record the user sees, several subjects history records.
    const user = await createTestUser("aggregated");

    await NotificationGenerationService.generate(
      draftFor(user.id, {
        intent: NotificationIntent.REGISTRATION_CLOSING,
        occurrenceKey: "closing:2026-09-17",
        targets: [1, 2, 3].map((rank) => ({
          targetType: NotificationTargetType.COMPETITION,
          targetId: `comp-${rank}`,
          targetVersion: "1790000000000",
          rank,
        })),
      }),
      NOW,
    );

    const notification = await prisma.notification.findFirstOrThrow({
      where: { userId: user.id },
      include: { targets: { orderBy: { rank: "asc" } } },
    });

    expect(notification.targets.map((t) => t.targetId)).toEqual([
      "comp-1",
      "comp-2",
      "comp-3",
    ]);
    expect(notification.targets[0]?.targetVersion).toBe("1790000000000");
  });

  it("creates exactly one in-app delivery, even though the constraint is invisible to Prisma", async () => {
    // Uniqueness of the in-app row rests on a PARTIAL index written by hand in
    // the migration, because Postgres treats NULLs as distinct and the
    // three-column constraint therefore does not cover it.
    const user = await createTestUser("one-inapp");

    await NotificationGenerationService.generate(draftFor(user.id), NOW);

    const notification = await prisma.notification.findFirstOrThrow({
      where: { userId: user.id },
    });

    await expect(
      prisma.notificationDelivery.create({
        data: {
          notificationId: notification.id,
          channel: "IN_APP",
          status: "DELIVERED",
          maxAttempts: 1,
        },
      }),
    ).rejects.toThrow();
  });
});
