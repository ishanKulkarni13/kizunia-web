/**
 * Admin announcements: authorization, scheduling, and resumable fan-out.
 *
 * Fan-out is the only unit of work here that is not bounded by a single user,
 * so it is the only one that has to manage its own progress — and the only one
 * where getting continuation wrong means either stalling or double-sending to
 * everybody at once.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  FeatureAnnouncementStatus,
  NotificationIntent,
} from "@/generated/prisma";
import prisma from "@/lib/prisma";
import type { StrictAuthorizationActor } from "@/authorization";
import { PlatformRole } from "@/authorization/platform/roles";
import { cleanupNotificationTestData } from "@/testing/notification-cleanup";

import { notificationJobHandlers } from "../jobs/handlers";
import { JobRunner } from "../jobs/job-runner";
import { PostgresWorkQueue } from "../jobs/postgres-work-queue";
import { AnnouncementService } from "./announcement.service";

const PREFIX = "__vitest_announcement_test__";

function unique(name: string): string {
  return `${PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

const queue = new PostgresWorkQueue();

/**
 * Actors backed by real user rows.
 *
 * `FeatureAnnouncement.createdById` is a genuine foreign key, so an actor whose
 * id does not exist fails at the database rather than at the authorization
 * check — which would make an authorization test pass for the wrong reason.
 */
async function createActor(
  role: PlatformRole,
  suffix: string,
): Promise<StrictAuthorizationActor> {
  const id = unique(`actor-${suffix}`);
  const user = await prisma.user.create({
    data: {
      id,
      name: `Announcement ${suffix}`,
      email: `${id}@example.test`,
      emailVerified: true,
      role,
      // Actors are also recipients; opting them out keeps recipient counts in
      // the fan-out tests about the users those tests actually created.
      notificationPreferences: {
        create: {
          intent: NotificationIntent.FEATURE_ANNOUNCEMENT,
          enabled: false,
        },
      },
    },
  });

  return { id: user.id, role, banned: false };
}

let admin: StrictAuthorizationActor;
let superAdmin: StrictAuthorizationActor;
let plainUser: StrictAuthorizationActor;
let moderator: StrictAuthorizationActor;

async function createRecipient(suffix: string, optedOut = false) {
  const id = unique(`user-${suffix}`);
  const user = await prisma.user.create({
    data: {
      id,
      name: "Announcement Recipient",
      email: `${id}@example.test`,
      emailVerified: true,
    },
  });

  if (optedOut) {
    await prisma.notificationPreference.create({
      data: {
        userId: user.id,
        intent: NotificationIntent.FEATURE_ANNOUNCEMENT,
        enabled: false,
      },
    });
  }

  return user;
}

async function drain() {
  return JobRunner.run({
    queue,
    handlers: notificationJobHandlers,
    random: () => 0,
  });
}

async function cleanup() {
  await prisma.featureAnnouncement.deleteMany({
    where: { title: { startsWith: PREFIX } },
  });
  await cleanupNotificationTestData(PREFIX);
}

beforeAll(async () => {
  await prisma.notificationJob.deleteMany({});
  await cleanup();
});

beforeEach(async () => {
  admin = await createActor(PlatformRole.ADMIN, "admin");
  superAdmin = await createActor(PlatformRole.SUPER_ADMIN, "super");
  plainUser = await createActor(PlatformRole.USER, "plain");
  moderator = await createActor(PlatformRole.MODERATOR, "mod");
});

afterEach(cleanup);

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("AnnouncementService — authorization", () => {
  it.each([
    ["an ordinary user", () => plainUser],
    ["a moderator", () => moderator],
  ])("refuses %s", async (_label, who) => {
    await expect(
      AnnouncementService.create(who(), {
        title: `${PREFIX} nope`,
        body: "should not happen",
      }),
    ).rejects.toThrow();

    expect(
      await prisma.featureAnnouncement.count({
        where: { title: { startsWith: PREFIX } },
      }),
    ).toBe(0);
  });

  it.each([
    ["an admin", () => admin],
    ["a super admin", () => superAdmin],
  ])("allows %s", async (_label, who) => {
    const announcement = await AnnouncementService.create(who(), {
      title: `${PREFIX} allowed`,
      body: "a real announcement",
    });

    expect(announcement.status).toBe(FeatureAnnouncementStatus.SCHEDULED);
  });

  it("refuses to list announcements to a non-admin", async () => {
    await expect(AnnouncementService.list(plainUser)).rejects.toThrow();
  });
});

describe("AnnouncementService — scheduling", () => {
  it("schedules the fan-out for the chosen time, not for now", async () => {
    // ND-I-22: delivery time is a property of the announcement. "Send now" is a
    // schedule time of now, not a separate path.
    const later = new Date(Date.now() + 60 * 60 * 1000);

    const announcement = await AnnouncementService.create(admin, {
      title: `${PREFIX} later`,
      body: "not yet",
      scheduledFor: later,
    });

    const job = await prisma.notificationJob.findFirstOrThrow({
      where: { kind: "FANOUT_ANNOUNCEMENT", dedupeKey: { contains: announcement.id } },
    });

    expect(job.runAt.getTime()).toBe(later.getTime());

    // And a drain now does not pick it up.
    await drain();
    expect(
      await prisma.notification.count({
        where: { intent: NotificationIntent.FEATURE_ANNOUNCEMENT },
      }),
    ).toBe(0);
  });

  it("validates the link rather than storing whatever arrives", async () => {
    // The only notification content a human authors, and so the only place an
    // unsafe destination could enter the system.
    for (const url of ["http://insecure.example", "javascript:alert(1)", "//evil.example"]) {
      await expect(
        AnnouncementService.create(admin, {
          title: `${PREFIX} bad link`,
          body: "body",
          // Bypassing the schema deliberately: this asserts the service is not
          // the only thing standing between an authored URL and the database.
          url: url as string,
        }),
      ).rejects.toThrow();
    }
  });
});

describe("AnnouncementService — fan-out", () => {
  it("reaches every user who has not opted out, and nobody who has", async () => {
    const wanted = await Promise.all([
      createRecipient("a"),
      createRecipient("b"),
      createRecipient("c"),
    ]);
    const optedOut = await createRecipient("opted-out", true);

    const announcement = await AnnouncementService.create(admin, {
      title: `${PREFIX} New feature`,
      body: "We shipped something.",
      url: "/competitions",
    });

    await drain();

    for (const user of wanted) {
      const notification = await prisma.notification.findFirstOrThrow({
        where: { userId: user.id, intent: NotificationIntent.FEATURE_ANNOUNCEMENT },
        include: { targets: true },
      });

      // Authored content, verbatim.
      expect(notification.title).toBe(`${PREFIX} New feature`);
      expect(notification.body).toBe("We shipped something.");
      expect(notification.actionPath).toBe("/competitions");
      // The first notification subject that is not a competition.
      expect(notification.targets[0]?.targetType).toBe("ANNOUNCEMENT");
      expect(notification.targets[0]?.targetId).toBe(announcement.id);
    }

    // Announcements default ON, so eligibility is "has not opted out" rather
    // than "has opted in" — the inverse of the recommendation intents.
    expect(
      await prisma.notification.count({ where: { userId: optedOut.id } }),
    ).toBe(0);

    const finished = await prisma.featureAnnouncement.findUniqueOrThrow({
      where: { id: announcement.id },
    });
    expect(finished.status).toBe(FeatureAnnouncementStatus.PUBLISHED);
    expect(finished.publishedAt).not.toBeNull();
  });

  it("keeps an external link out of the action path", async () => {
    const user = await createRecipient("external");

    await AnnouncementService.create(admin, {
      title: `${PREFIX} External`,
      body: "Read more elsewhere.",
      url: "https://example.com/post",
    });

    await drain();

    const notification = await prisma.notification.findFirstOrThrow({
      where: { userId: user.id },
    });

    // `actionPath` is site-relative by contract, and the database enforces it.
    // An off-platform link lives in the payload, where the client renders it as
    // what it is rather than as an in-app route.
    expect(notification.actionPath).toBeNull();
    expect(notification.payload).toMatchObject({
      externalUrl: "https://example.com/post",
    });
  });

  it("resumes across pages instead of restarting or double-sending", async () => {
    // The property that matters at any real user count. Fan-out re-arms its own
    // row with an advanced cursor rather than enqueueing a successor — a
    // successor would carry the same dedupe key as the row creating it.
    const recipients = await Promise.all(
      Array.from({ length: 7 }, (_, i) => createRecipient(`page-${i}`)),
    );

    const announcement = await AnnouncementService.create(admin, {
      title: `${PREFIX} Paged`,
      body: "Everybody gets one.",
    });

    // Force several pages by shrinking the page size for this run.
    const { SCHEDULE_CONFIG } = await import("../config/notification-config");
    const originalPageSize = SCHEDULE_CONFIG.userPageSize;
    Object.defineProperty(SCHEDULE_CONFIG, "userPageSize", {
      value: 2,
      configurable: true,
    });

    try {
      await drain();
    } finally {
      Object.defineProperty(SCHEDULE_CONFIG, "userPageSize", {
        value: originalPageSize,
        configurable: true,
      });
    }

    for (const user of recipients) {
      expect(
        await prisma.notification.count({
          where: { userId: user.id, intent: NotificationIntent.FEATURE_ANNOUNCEMENT },
        }),
      ).toBe(1);
    }

    // One job row throughout, never a chain of them.
    expect(
      await prisma.notificationJob.count({
        where: {
          kind: "FANOUT_ANNOUNCEMENT",
          dedupeKey: { contains: announcement.id },
        },
      }),
    ).toBe(1);

    const finished = await prisma.featureAnnouncement.findUniqueOrThrow({
      where: { id: announcement.id },
    });
    expect(finished.status).toBe(FeatureAnnouncementStatus.PUBLISHED);
  });

  it("produces one notification per user however many times fan-out runs", async () => {
    const user = await createRecipient("rerun");

    const announcement = await AnnouncementService.create(admin, {
      title: `${PREFIX} Once`,
      body: "Only once.",
    });

    await drain();

    // Re-arm the finished job and run it again — the nervous-operator case.
    await prisma.notificationJob.updateMany({
      where: { dedupeKey: { contains: announcement.id } },
      data: { status: "PENDING", runAt: new Date(Date.now() - 1000), attempts: 0 },
    });
    await drain();

    expect(
      await prisma.notification.count({
        where: { userId: user.id, intent: NotificationIntent.FEATURE_ANNOUNCEMENT },
      }),
    ).toBe(1);
  });
});

describe("AnnouncementService — cancellation", () => {
  it("stops a scheduled announcement before it goes out", async () => {
    const user = await createRecipient("cancelled");

    const announcement = await AnnouncementService.create(admin, {
      title: `${PREFIX} Cancelled`,
      body: "Never mind.",
      scheduledFor: new Date(Date.now() + 60 * 60 * 1000),
    });

    const cancelled = await AnnouncementService.cancel(admin, announcement.id);
    expect(cancelled.status).toBe(FeatureAnnouncementStatus.CANCELLED);

    // The job is cancelled too, so no worker picks up work that was called off.
    const job = await prisma.notificationJob.findFirstOrThrow({
      where: { dedupeKey: { contains: announcement.id } },
    });
    expect(job.status).toBe("CANCELLED");

    await drain();
    expect(
      await prisma.notification.count({ where: { userId: user.id } }),
    ).toBe(0);
  });

  it("refuses to cancel something that has already gone out", async () => {
    await createRecipient("published");

    const announcement = await AnnouncementService.create(admin, {
      title: `${PREFIX} Published`,
      body: "Already sent.",
    });

    await drain();

    // Cancelling after the fact would imply a retraction the system cannot
    // perform — the notifications are history (ND-H-02).
    await expect(
      AnnouncementService.cancel(admin, announcement.id),
    ).rejects.toThrow(/already gone out/i);
  });

  it("refuses to cancel someone else's business", async () => {
    const announcement = await AnnouncementService.create(admin, {
      title: `${PREFIX} Guarded`,
      body: "body",
      scheduledFor: new Date(Date.now() + 60 * 60 * 1000),
    });

    await expect(
      AnnouncementService.cancel(plainUser, announcement.id),
    ).rejects.toThrow();
  });
});
