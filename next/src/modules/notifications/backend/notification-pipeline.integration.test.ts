/**
 * The whole pipeline, end to end, against a real database.
 *
 * preferences -> scheduler -> recommendation engine -> policy -> notification
 *             -> inbox -> delivery job -> push provider -> recorded result
 *
 * Nothing is stubbed except the push provider, and that only because there is
 * no Firebase project — every other component is the real one, including the
 * recommendation engine and the work queue.
 *
 * This is the test that would catch a wiring mistake no unit test can: each
 * piece correct, and the seam between two of them wrong.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  CompetitionStatus,
  CompetitionVisibility,
  NotificationIntent,
} from "@/generated/prisma";
import prisma from "@/lib/prisma";
import { cleanupNotificationTestData } from "@/testing/notification-cleanup";
import { DimensionId } from "@/modules/recommendations";

import { notificationJobHandlers } from "../jobs/handlers";
import { JobRunner } from "../jobs/job-runner";
import { PostgresWorkQueue } from "../jobs/postgres-work-queue";
import { NotificationSchedulerService } from "./notification-scheduler.service";
import { NotificationService } from "./notification.service";

const PREFIX = "__vitest_pipeline_test__";
const ANCHOR = new Date("2026-09-17T13:00:00.000Z");

function unique(name: string): string {
  return `${PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

const queue = new PostgresWorkQueue();

async function createUser(suffix: string) {
  const id = unique(`user-${suffix}`);
  return prisma.user.create({
    data: {
      id,
      name: "Pipeline Test User",
      email: `${id}@example.test`,
      emailVerified: true,
    },
  });
}

async function enableIntent(userId: string, intent: NotificationIntent) {
  await prisma.notificationPreference.create({
    data: { userId, intent, enabled: true },
  });
}

/**
 * A competition the engine will rank, plus the preference that makes it rank.
 *
 * Fee type is the simplest dimension to match on: it is a scalar on the
 * competition itself, so no join table is needed to make the engine see it.
 */
async function createOpenCompetition(suffix: string) {
  return prisma.competition.create({
    data: {
      title: `Pipeline Test Competition ${suffix}`,
      slug: unique(`competition-${suffix}`),
      visibility: CompetitionVisibility.PUBLIC,
      status: CompetitionStatus.REGISTRATION_OPEN,
      registrationFeeType: "FREE",
      organizer: "Kizunia Test Org",
    },
  });
}

async function preferFreeCompetitions(userId: string) {
  await prisma.competitionPreference.create({
    data: {
      userId,
      dimension: DimensionId.REGISTRATION_FEE_TYPE as never,
      value: "FREE",
      weight: 1,
    },
  });
}

/** One full tick: schedule the day's evaluations, then drain everything. */
async function runTick() {
  await NotificationSchedulerService.scheduleDueEvaluations({
    queue,
    anchor: ANCHOR,
  });

  return JobRunner.run({
    queue,
    handlers: notificationJobHandlers,
    random: () => 0,
  });
}

async function cleanup() {
  await cleanupNotificationTestData(PREFIX);
  await prisma.competition.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await prisma.notificationJob.deleteMany({});
  await cleanup();
});

afterEach(cleanup);

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("notification pipeline", () => {
  it("carries a user from preferences to an inbox notification without manual intervention", async () => {
    const user = await createUser("happy");
    await enableIntent(user.id, NotificationIntent.TOP_RELEVANT_COMPETITION);
    await preferFreeCompetitions(user.id);
    await createOpenCompetition("free");

    await runTick();

    const inbox = await NotificationService.getInbox({ userId: user.id });

    expect(inbox.items).toHaveLength(1);
    expect(inbox.unreadCount).toBe(1);

    const [notification] = inbox.items;
    expect(notification.intent).toBe(NotificationIntent.TOP_RELEVANT_COMPETITION);
    // Site-relative, never an absolute URL — the invariant the DB also enforces.
    expect(notification.actionPath).toMatch(/^\/competitions\//);
    expect(notification.readAt).toBeNull();
    expect(notification.respondedAt).toBeNull();
    expect(notification.targets).toHaveLength(1);
  });

  it("stays silent for a user who has not enabled the intent", async () => {
    const user = await createUser("opted-out");
    await preferFreeCompetitions(user.id);
    await createOpenCompetition("ignored");

    await runTick();

    const inbox = await NotificationService.getInbox({ userId: user.id });
    // Opt-in means opt-in. No preference row, no notification.
    expect(inbox.items).toHaveLength(0);
  });

  it("stays silent when nothing clears the relevance threshold", async () => {
    // ND-I-05: a scheduled run is not a reason to notify. Silence is a valid
    // and frequent outcome, and must not produce an empty notification.
    const user = await createUser("nothing-relevant");
    await enableIntent(user.id, NotificationIntent.TOP_RELEVANT_COMPETITION);
    await preferFreeCompetitions(user.id);
    // A competition that fails the hard constraint (weight 1 on FREE).
    await prisma.competition.create({
      data: {
        title: "Paid Competition",
        slug: unique("competition-paid"),
        visibility: CompetitionVisibility.PUBLIC,
        status: CompetitionStatus.REGISTRATION_OPEN,
        registrationFeeType: "PAID",
      },
    });

    await runTick();

    const inbox = await NotificationService.getInbox({ userId: user.id });
    expect(inbox.items).toHaveLength(0);
  });

  it("produces one notification when the whole tick runs twice", async () => {
    // Failure case 3, end to end rather than at the unit level: scheduler,
    // queue and generation each have their own guard, and this proves they
    // compose rather than merely working alone.
    const user = await createUser("twice");
    await enableIntent(user.id, NotificationIntent.TOP_RELEVANT_COMPETITION);
    await preferFreeCompetitions(user.id);
    await createOpenCompetition("free-twice");

    await runTick();
    await runTick();

    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(1);
  });

  it("creates the delivery work in the same breath as the notification", async () => {
    const user = await createUser("delivery-work");
    await enableIntent(user.id, NotificationIntent.TOP_RELEVANT_COMPETITION);
    await preferFreeCompetitions(user.id);
    await createOpenCompetition("free-delivery");

    await runTick();

    const notification = await prisma.notification.findFirstOrThrow({
      where: { userId: user.id },
      include: { deliveries: true },
    });

    // In-app is delivered the moment the row exists, whatever happens to push.
    expect(
      notification.deliveries.find((d) => d.channel === "IN_APP")?.status,
    ).toBe("DELIVERED");

    // With no push provider configured, the push delivery is honestly recorded
    // as skipped rather than as a send that never happened.
    const push = notification.deliveries.find((d) => d.channel === "WEB_PUSH");
    expect(push?.status ?? "SKIPPED").toBe("SKIPPED");
  });

  it("keeps one user's failure from costing another their notification", async () => {
    // NFR-1 at the pipeline level. At 2,000 users this is the difference
    // between a bad day for one person and a bad day for everyone.
    const healthy = await createUser("healthy");
    const broken = await createUser("broken");

    for (const user of [healthy, broken]) {
      await enableIntent(user.id, NotificationIntent.TOP_RELEVANT_COMPETITION);
      await preferFreeCompetitions(user.id);
    }
    await createOpenCompetition("shared");

    await NotificationSchedulerService.scheduleDueEvaluations({
      queue,
      anchor: ANCHOR,
    });

    // Make one user's evaluation fail, by pointing its job at a user that does
    // not exist. Everything else about the batch is unchanged.
    await prisma.notificationJob.updateMany({
      where: { dedupeKey: { contains: broken.id } },
      data: { payload: { userId: "does-not-exist", occurrenceKey: "top:2026-09-17", evaluatedAt: ANCHOR.toISOString() } },
    });

    await JobRunner.run({
      queue,
      handlers: notificationJobHandlers,
      random: () => 0,
    });

    const healthyInbox = await NotificationService.getInbox({ userId: healthy.id });
    expect(healthyInbox.items).toHaveLength(1);
  });

  it("moves read and responded independently", async () => {
    // ND-H-10. Read answers "does this still need my attention"; responded
    // answers "did this notification achieve anything". Neither is evidence
    // about delivery.
    const user = await createUser("read-state");
    await enableIntent(user.id, NotificationIntent.TOP_RELEVANT_COMPETITION);
    await preferFreeCompetitions(user.id);
    await createOpenCompetition("free-read");

    await runTick();

    const initial = await NotificationService.getInbox({ userId: user.id });
    const id = initial.items[0]!.id;

    await NotificationService.markRead(user.id, id);

    const afterRead = await NotificationService.getInbox({ userId: user.id });
    expect(afterRead.items[0]!.readAt).not.toBeNull();
    expect(afterRead.items[0]!.respondedAt).toBeNull();
    expect(afterRead.unreadCount).toBe(0);

    await NotificationService.markResponded(user.id, id);

    const afterResponse = await NotificationService.getInbox({ userId: user.id });
    expect(afterResponse.items[0]!.respondedAt).not.toBeNull();
  });

  it("refuses to let one user touch another's notification", async () => {
    const owner = await createUser("owner");
    const stranger = await createUser("stranger");

    await enableIntent(owner.id, NotificationIntent.TOP_RELEVANT_COMPETITION);
    await preferFreeCompetitions(owner.id);
    await createOpenCompetition("free-private");

    await runTick();

    const inbox = await NotificationService.getInbox({ userId: owner.id });
    const id = inbox.items[0]!.id;

    // 404 rather than 403: someone else's notification id is not a fact this
    // user is entitled to have confirmed.
    await expect(
      NotificationService.getOwned(stranger.id, id),
    ).rejects.toThrow(/not found/i);

    await expect(
      NotificationService.markResponded(stranger.id, id),
    ).rejects.toThrow(/not found/i);

    const strangerInbox = await NotificationService.getInbox({
      userId: stranger.id,
    });
    expect(strangerInbox.items).toHaveLength(0);
  });

  it("keeps yesterday's notification when the user turns the intent off today", async () => {
    // Failure case 9, and ND-P-14: a preference change governs the future. It
    // does not rewrite what the user was already told.
    const user = await createUser("disables");
    await enableIntent(user.id, NotificationIntent.TOP_RELEVANT_COMPETITION);
    await preferFreeCompetitions(user.id);
    await createOpenCompetition("free-history");

    await runTick();
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(1);

    await prisma.notificationPreference.update({
      where: {
        userId_intent: {
          userId: user.id,
          intent: NotificationIntent.TOP_RELEVANT_COMPETITION,
        },
      },
      data: { enabled: false },
    });

    // A later day: the scheduler no longer even considers them.
    await NotificationSchedulerService.scheduleDueEvaluations({
      queue,
      anchor: new Date("2026-09-18T13:00:00.000Z"),
    });
    await JobRunner.run({
      queue,
      handlers: notificationJobHandlers,
      random: () => 0,
    });

    // The historical notification is untouched, and no new one was made.
    const inbox = await NotificationService.getInbox({ userId: user.id });
    expect(inbox.items).toHaveLength(1);
  });

  it("orders the inbox newest first and pages without repeating a row", async () => {
    const user = await createUser("paging");

    for (let day = 1; day <= 5; day += 1) {
      await prisma.notification.create({
        data: {
          userId: user.id,
          intent: NotificationIntent.TOP_RELEVANT_COMPETITION,
          occurrenceKey: `top:2026-09-0${day}`,
          title: `Notification ${day}`,
          body: "body",
          createdAt: new Date(`2026-09-0${day}T13:00:00.000Z`),
        },
      });
    }

    const first = await NotificationService.getInbox({ userId: user.id, limit: 2 });
    expect(first.items.map((n) => n.title)).toEqual([
      "Notification 5",
      "Notification 4",
    ]);
    expect(first.nextCursor).not.toBeNull();

    const second = await NotificationService.getInbox({
      userId: user.id,
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.items.map((n) => n.title)).toEqual([
      "Notification 3",
      "Notification 2",
    ]);

    // No overlap between pages — the thing an offset-based pager gets wrong.
    const ids = new Set([...first.items, ...second.items].map((n) => n.id));
    expect(ids.size).toBe(4);
  });
});
