/**
 * Admin notification for new competition suggestions, end to end.
 *
 * discovery sweep -> policy re-check -> notification -> in-app delivery + push
 * job -> inbox
 *
 * Nothing is stubbed except the push provider, and that only because there is
 * no Firebase project in this environment — the discovery query, the policy,
 * the renderer, generation and the in-app delivery are all real, against a
 * real database.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  NotificationIntent,
  SuggestionStatus,
} from "@/generated/prisma";
import prisma from "@/lib/prisma";
import type { StrictAuthorizationActor } from "@/authorization";
import { PlatformRole } from "@/authorization/platform/roles";
import { cleanupNotificationTestData } from "@/testing/notification-cleanup";

import { ADMIN_NOTICE_CONFIG, SCHEDULE_CONFIG } from "../config/notification-config";
import { resetPushProviderCache } from "../delivery/push-provider.factory";
import { notificationJobHandlers } from "../jobs/handlers";
import { JobRunner } from "../jobs/job-runner";
import { PostgresWorkQueue } from "../jobs/postgres-work-queue";
import { NotificationSchedulerService } from "./notification-scheduler.service";

const PREFIX = "__vitest_admin_suggestion_test__";
const DELAY_SECONDS = ADMIN_NOTICE_CONFIG.suggestionNoticeDelaySeconds;
const LOOKBACK_SECONDS = ADMIN_NOTICE_CONFIG.suggestionLookbackSeconds;

function unique(name: string): string {
  return `${PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

const queue = new PostgresWorkQueue();

async function createActor(
  role: PlatformRole,
  suffix: string,
): Promise<StrictAuthorizationActor> {
  const id = unique(`actor-${suffix}`);
  const user = await prisma.user.create({
    data: {
      id,
      name: `Suggestion Notice ${suffix}`,
      email: `${id}@example.test`,
      emailVerified: true,
      role,
    },
  });

  return { id: user.id, role, banned: false };
}

/**
 * A suggestion, submitted `ageSeconds` ago, in `UNDER_REVIEW`.
 *
 * Created directly through Prisma rather than through
 * `CompetitionSuggestionService.submit` so `submittedAt` can be placed
 * precisely relative to the discovery anchor — the one thing every test here
 * actually varies.
 */
async function createSubmittedSuggestion(input: {
  suffix: string;
  submittedById: string;
  ageSeconds: number;
  anchor: Date;
  status?: SuggestionStatus;
  reviewedAt?: Date | null;
  deletedAt?: Date | null;
}) {
  return prisma.competitionSuggestion.create({
    data: {
      suggestionTitle: `${PREFIX} ${input.suffix}`,
      submittedById: input.submittedById,
      status: input.status ?? SuggestionStatus.UNDER_REVIEW,
      submittedAt: new Date(input.anchor.getTime() - input.ageSeconds * 1000),
      reviewedAt: input.reviewedAt ?? null,
      deletedAt: input.deletedAt ?? null,
    },
  });
}

async function runDiscovery(anchor: Date) {
  return NotificationSchedulerService.scheduleAdminSuggestionNotices({
    queue,
    anchor,
  });
}

async function drain(now?: Date) {
  return JobRunner.run({
    queue,
    handlers: notificationJobHandlers,
    random: () => 0,
    // Defaults to the real clock. Tests that move `anchor` into the future
    // (the resubmission test) must say so explicitly, or a job whose `runAt`
    // is that future anchor is correctly not yet due and never gets claimed.
    ...(now ? { now: () => now } : {}),
  });
}

async function cleanup() {
  // `cleanupNotificationTestData` cannot see these rows: a
  // NOTIFY_ADMINS_OF_SUGGESTION job's dedupe key is built from the
  // suggestion's own cuid and its occurrence key, neither of which contains
  // this file's prefix or a notification id — the two things that helper
  // matches on. Deleting the suggestion leaves the job orphaned but present,
  // where a later test's unscoped `findFirstOrThrow` can pick it up instead of
  // its own. Safe to delete every row of this kind unconditionally: this file
  // is the only one that creates them, and integration files run one at a
  // time (`vitest.integration.config.mts`'s `fileParallelism: false`).
  await prisma.notificationJob.deleteMany({
    where: { kind: "NOTIFY_ADMINS_OF_SUGGESTION" },
  });
  await prisma.competitionSuggestion.deleteMany({
    where: { suggestionTitle: { startsWith: PREFIX } },
  });
  await cleanupNotificationTestData(PREFIX);
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

describe("admin suggestion notice — discovery and timing", () => {
  it("does not notify before the grace delay has elapsed", async () => {
    const anchor = new Date();
    const submitter = await createActor(PlatformRole.USER, "submitter-early");
    await createActor(PlatformRole.ADMIN, "reviewer-early");

    await createSubmittedSuggestion({
      suffix: "too-fresh",
      submittedById: submitter.id,
      ageSeconds: DELAY_SECONDS / 2,
      anchor,
    });

    const result = await runDiscovery(anchor);
    expect(result.enqueued).toBe(0);

    await drain();
    expect(
      await prisma.notification.count({
        where: { intent: NotificationIntent.ADMIN_COMPETITION_SUGGESTION },
      }),
    ).toBe(0);
  });

  it("does not notify about a suggestion older than the lookback window", async () => {
    const anchor = new Date();
    const submitter = await createActor(PlatformRole.USER, "submitter-stale");
    await createActor(PlatformRole.ADMIN, "reviewer-stale");

    // Predates the feature: enabling this must not page anyone about a
    // pre-existing backlog.
    await createSubmittedSuggestion({
      suffix: "ancient",
      submittedById: submitter.id,
      ageSeconds: LOOKBACK_SECONDS + DELAY_SECONDS,
      anchor,
    });

    const result = await runDiscovery(anchor);
    expect(result.enqueued).toBe(0);
  });

  it("notifies once a suggestion has waited long enough", async () => {
    const anchor = new Date();
    const submitter = await createActor(PlatformRole.USER, "submitter-ready");
    const reviewer = await createActor(PlatformRole.ADMIN, "reviewer-ready");

    const suggestion = await createSubmittedSuggestion({
      suffix: "ready",
      submittedById: submitter.id,
      ageSeconds: DELAY_SECONDS + 60,
      anchor,
    });

    const result = await runDiscovery(anchor);
    expect(result.enqueued).toBe(1);

    await drain();

    const notification = await prisma.notification.findFirstOrThrow({
      where: {
        userId: reviewer.id,
        intent: NotificationIntent.ADMIN_COMPETITION_SUGGESTION,
      },
      include: { targets: true },
    });

    expect(notification.title).toBe("New competition suggestion");
    expect(notification.body).toContain(suggestion.suggestionTitle);
    expect(notification.actionPath).toBe(
      `/admin/competition-suggestions/${suggestion.id}`,
    );
    expect(notification.targets).toHaveLength(1);
    expect(notification.targets[0]?.targetType).toBe("COMPETITION_SUGGESTION");
    expect(notification.targets[0]?.targetId).toBe(suggestion.id);

    // In-app delivery completes at persistence — no transport, no
    // acknowledgement, the row itself is the delivery.
    const inApp = await prisma.notificationDelivery.findFirstOrThrow({
      where: { notificationId: notification.id, channel: "IN_APP" },
    });
    expect(inApp.status).toBe("DELIVERED");

    // The push job exists — delivery is a separate concern this test does not
    // need to resolve further; `delivery.integration.test.ts` already covers
    // provider success, failure and invalid tokens for every intent, this one
    // included, because delivery is intent-agnostic.
    expect(
      await prisma.notificationJob.count({
        where: { kind: "DELIVER_NOTIFICATION", dedupeKey: { contains: notification.id } },
      }),
    ).toBe(1);
  });
});

describe("admin suggestion notice — recipients", () => {
  it("reaches every reviewer, and nobody without the review permission", async () => {
    const anchor = new Date();
    const submitter = await createActor(PlatformRole.USER, "submitter-fanout");
    const admin = await createActor(PlatformRole.ADMIN, "reviewer-fanout-admin");
    const superAdmin = await createActor(
      PlatformRole.SUPER_ADMIN,
      "reviewer-fanout-super",
    );
    const plainUser = await createActor(PlatformRole.USER, "plain-fanout");
    const moderator = await createActor(PlatformRole.MODERATOR, "mod-fanout");

    await createSubmittedSuggestion({
      suffix: "fanout",
      submittedById: submitter.id,
      ageSeconds: DELAY_SECONDS + 60,
      anchor,
    });

    await runDiscovery(anchor);
    await drain();

    for (const reviewer of [admin, superAdmin]) {
      expect(
        await prisma.notification.count({
          where: {
            userId: reviewer.id,
            intent: NotificationIntent.ADMIN_COMPETITION_SUGGESTION,
          },
        }),
      ).toBe(1);
    }

    // MODERATOR does not currently hold REVIEW_COMPETITION_SUGGESTIONS
    // (permission-set.ts), so it must not be a recipient — the whole point of
    // deriving the audience from the permission set rather than hard-coding
    // role names is that this stays true automatically.
    for (const nonReviewer of [plainUser, moderator]) {
      expect(
        await prisma.notification.count({ where: { userId: nonReviewer.id } }),
      ).toBe(0);
    }
  });

  it("does not notify the submitter about their own suggestion, even if they are a reviewer", async () => {
    const anchor = new Date();
    const adminSubmitter = await createActor(
      PlatformRole.ADMIN,
      "admin-self-submit",
    );
    const otherReviewer = await createActor(
      PlatformRole.ADMIN,
      "other-reviewer-self",
    );

    await createSubmittedSuggestion({
      suffix: "self-submitted",
      submittedById: adminSubmitter.id,
      ageSeconds: DELAY_SECONDS + 60,
      anchor,
    });

    await runDiscovery(anchor);
    await drain();

    expect(
      await prisma.notification.count({ where: { userId: adminSubmitter.id } }),
    ).toBe(0);
    expect(
      await prisma.notification.count({
        where: {
          userId: otherReviewer.id,
          intent: NotificationIntent.ADMIN_COMPETITION_SUGGESTION,
        },
      }),
    ).toBe(1);
  });

  it("skips a reviewer who has switched the intent off", async () => {
    const anchor = new Date();
    const submitter = await createActor(PlatformRole.USER, "submitter-optout");
    const optedOut = await createActor(PlatformRole.ADMIN, "reviewer-optout");
    await prisma.notificationPreference.create({
      data: {
        userId: optedOut.id,
        intent: NotificationIntent.ADMIN_COMPETITION_SUGGESTION,
        enabled: false,
      },
    });
    const optedIn = await createActor(PlatformRole.ADMIN, "reviewer-optin");

    await createSubmittedSuggestion({
      suffix: "optout",
      submittedById: submitter.id,
      ageSeconds: DELAY_SECONDS + 60,
      anchor,
    });

    await runDiscovery(anchor);
    await drain();

    expect(
      await prisma.notification.count({ where: { userId: optedOut.id } }),
    ).toBe(0);
    expect(
      await prisma.notification.count({ where: { userId: optedIn.id } }),
    ).toBe(1);
  });

  it("resumes fan-out across pages instead of restarting or double-sending", async () => {
    const anchor = new Date();
    const submitter = await createActor(PlatformRole.USER, "submitter-paged");
    const reviewers = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        createActor(PlatformRole.ADMIN, `reviewer-paged-${i}`),
      ),
    );

    const suggestion = await createSubmittedSuggestion({
      suffix: "paged",
      submittedById: submitter.id,
      ageSeconds: DELAY_SECONDS + 60,
      anchor,
    });

    await runDiscovery(anchor);

    // Force several pages by shrinking the page size for this run — the same
    // technique the announcement fan-out test uses, and for the same reason:
    // production reviewer counts are small, so the only way to exercise
    // continuation deterministically is to lower the threshold rather than
    // create hundreds of admins.
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

    for (const reviewer of reviewers) {
      expect(
        await prisma.notification.count({
          where: {
            userId: reviewer.id,
            intent: NotificationIntent.ADMIN_COMPETITION_SUGGESTION,
          },
        }),
      ).toBe(1);
    }

    // One job row throughout — re-armed, never chained. A successor would
    // carry the same dedupe key as the row creating it and collide with it.
    expect(
      await prisma.notificationJob.count({
        where: {
          kind: "NOTIFY_ADMINS_OF_SUGGESTION",
          dedupeKey: { contains: suggestion.id },
        },
      }),
    ).toBe(1);
  });
});

describe("admin suggestion notice — idempotency and re-validation", () => {
  it("running discovery twice enqueues no duplicate job", async () => {
    const anchor = new Date();
    const submitter = await createActor(PlatformRole.USER, "submitter-twice");
    await createActor(PlatformRole.ADMIN, "reviewer-twice");

    await createSubmittedSuggestion({
      suffix: "twice",
      submittedById: submitter.id,
      ageSeconds: DELAY_SECONDS + 60,
      anchor,
    });

    const first = await runDiscovery(anchor);
    const second = await runDiscovery(anchor);

    expect(first.enqueued).toBe(1);
    expect(second.enqueued).toBe(0);
    expect(second.duplicates).toBe(1);
  });

  it("produces exactly one notification per reviewer however many times the whole tick runs", async () => {
    const anchor = new Date();
    const submitter = await createActor(PlatformRole.USER, "submitter-rerun");
    const reviewer = await createActor(PlatformRole.ADMIN, "reviewer-rerun");

    await createSubmittedSuggestion({
      suffix: "rerun",
      submittedById: submitter.id,
      ageSeconds: DELAY_SECONDS + 60,
      anchor,
    });

    await runDiscovery(anchor);
    await drain();
    // A second full pass: re-discovery (absorbed by the dedupe key) plus a
    // drain that finds nothing new to claim.
    await runDiscovery(anchor);
    await drain();

    expect(
      await prisma.notification.count({
        where: {
          userId: reviewer.id,
          intent: NotificationIntent.ADMIN_COMPETITION_SUGGESTION,
        },
      }),
    ).toBe(1);
  });

  it("suppresses the notice, without failing the job, when the suggestion was reviewed inside the grace window", async () => {
    const anchor = new Date();
    const submitter = await createActor(PlatformRole.USER, "submitter-reviewed");
    await createActor(PlatformRole.ADMIN, "reviewer-for-reviewed");

    const suggestion = await createSubmittedSuggestion({
      suffix: "reviewed",
      submittedById: submitter.id,
      ageSeconds: DELAY_SECONDS + 60,
      anchor,
    });

    await runDiscovery(anchor);

    // The ordinary case the delay exists to catch: someone already looking at
    // the queue reviews it before the notice job runs.
    await prisma.competitionSuggestion.update({
      where: { id: suggestion.id },
      data: { status: SuggestionStatus.APPROVED, reviewedAt: new Date() },
    });

    const drained = await drain();

    expect(drained.failed).toBe(0);
    expect(
      await prisma.notification.count({
        where: { intent: NotificationIntent.ADMIN_COMPETITION_SUGGESTION },
      }),
    ).toBe(0);
  });

  it("suppresses the notice when the suggestion was withdrawn inside the grace window", async () => {
    const anchor = new Date();
    const submitter = await createActor(PlatformRole.USER, "submitter-withdrawn");
    await createActor(PlatformRole.ADMIN, "reviewer-for-withdrawn");

    const suggestion = await createSubmittedSuggestion({
      suffix: "withdrawn",
      submittedById: submitter.id,
      ageSeconds: DELAY_SECONDS + 60,
      anchor,
    });

    await runDiscovery(anchor);

    await prisma.competitionSuggestion.update({
      where: { id: suggestion.id },
      data: { status: SuggestionStatus.WITHDRAWN },
    });

    await drain();

    expect(
      await prisma.notification.count({
        where: { intent: NotificationIntent.ADMIN_COMPETITION_SUGGESTION },
      }),
    ).toBe(0);
  });

  it("suppresses the older occasion when the suggestion was resubmitted before the job ran", async () => {
    const anchor = new Date();
    const submitter = await createActor(PlatformRole.USER, "submitter-resubmit");
    const reviewer = await createActor(PlatformRole.ADMIN, "reviewer-for-resubmit");

    const suggestion = await createSubmittedSuggestion({
      suffix: "resubmit",
      submittedById: submitter.id,
      ageSeconds: DELAY_SECONDS + 60,
      anchor,
    });

    await runDiscovery(anchor);

    // Changes requested, then resubmitted — a later occasion now exists, which
    // is what this job's frozen `submittedAt` no longer matches.
    const resubmittedAt = new Date();
    await prisma.competitionSuggestion.update({
      where: { id: suggestion.id },
      data: { status: SuggestionStatus.UNDER_REVIEW, submittedAt: resubmittedAt },
    });

    const drained = await drain();

    expect(drained.failed).toBe(0);
    // The stale job produced nothing.
    expect(
      await prisma.notification.count({
        where: { intent: NotificationIntent.ADMIN_COMPETITION_SUGGESTION },
      }),
    ).toBe(0);

    // And the resubmission is itself discoverable once it, too, has waited out
    // the grace delay — proving this is "not yet due", not "suppressed
    // forever". Both the discovery anchor and the drain's clock move together:
    // this is simulating time passing, not asking the real clock to somehow
    // already be past a fictional future instant.
    const laterAnchor = new Date(resubmittedAt.getTime() + DELAY_SECONDS * 1000 + 60_000);
    const result = await runDiscovery(laterAnchor);
    expect(result.enqueued).toBe(1);

    await drain(laterAnchor);
    expect(
      await prisma.notification.count({
        where: {
          userId: reviewer.id,
          intent: NotificationIntent.ADMIN_COMPETITION_SUGGESTION,
        },
      }),
    ).toBe(1);
  });

  it("fails the job permanently, without retry, when the suggestion has been hard-deleted", async () => {
    const anchor = new Date();
    const submitter = await createActor(PlatformRole.USER, "submitter-gone");
    await createActor(PlatformRole.ADMIN, "reviewer-for-gone");

    const suggestion = await createSubmittedSuggestion({
      suffix: "gone",
      submittedById: submitter.id,
      ageSeconds: DELAY_SECONDS + 60,
      anchor,
    });

    await runDiscovery(anchor);

    // Hard-deleted, not soft-deleted: the row the job's payload points at is
    // simply gone. `deletedAt` alone is covered by the "no longer awaiting
    // review" suppression path above; this exercises the other guard.
    await prisma.competitionSuggestion.delete({ where: { id: suggestion.id } });

    const drained = await drain();

    expect(drained.failed).toBe(1);

    const job = await prisma.notificationJob.findFirstOrThrow({
      where: { kind: "NOTIFY_ADMINS_OF_SUGGESTION", dedupeKey: { contains: suggestion.id } },
    });
    expect(job.status).toBe("FAILED");
    // Permanent: one attempt burned, not retried to exhaustion.
    expect(job.attempts).toBe(1);
  });
});

describe("admin suggestion notice — crash recovery and concurrency", () => {
  it("a worker that crashes mid-job loses nothing — the expired lease is re-claimed and completes the notice", async () => {
    const anchor = new Date();
    const submitter = await createActor(PlatformRole.USER, "submitter-crash");
    const reviewer = await createActor(PlatformRole.ADMIN, "reviewer-crash");

    const suggestion = await createSubmittedSuggestion({
      suffix: "crash",
      submittedById: submitter.id,
      ageSeconds: DELAY_SECONDS + 60,
      anchor,
    });

    await runDiscovery(anchor);

    // Simulates a worker that claimed the job and then died: a lease in the
    // past, no completion recorded. `reapExpired` would eventually mark this
    // FAILED only once attempts are exhausted; a fresh drain within budget
    // re-claims it instead, exactly like the generic queue-level crash-recovery
    // test, but exercised through this handler specifically.
    const job = await prisma.notificationJob.findFirstOrThrow({
      where: {
        kind: "NOTIFY_ADMINS_OF_SUGGESTION",
        dedupeKey: { contains: suggestion.id },
      },
    });
    await prisma.notificationJob.update({
      where: { id: job.id },
      data: {
        status: "PROCESSING",
        attempts: 1,
        leaseOwner: "dead-worker",
        leaseExpiresAt: new Date(Date.now() - 1000),
      },
    });

    const drained = await drain();
    expect(drained.completed).toBeGreaterThan(0);

    const finished = await prisma.notificationJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    // Attempts increments on claim, not on completion — the crashed attempt
    // plus the recovering one.
    expect(finished.attempts).toBe(2);
    expect(finished.status).toBe("COMPLETED");

    expect(
      await prisma.notification.count({
        where: {
          userId: reviewer.id,
          intent: NotificationIntent.ADMIN_COMPETITION_SUGGESTION,
        },
      }),
    ).toBe(1);
  });

  it("two concurrent drains never claim the same notice job", async () => {
    const anchor = new Date();
    const submitter = await createActor(PlatformRole.USER, "submitter-concurrent");
    const reviewer = await createActor(PlatformRole.ADMIN, "reviewer-concurrent");

    await createSubmittedSuggestion({
      suffix: "concurrent",
      submittedById: submitter.id,
      ageSeconds: DELAY_SECONDS + 60,
      anchor,
    });

    await runDiscovery(anchor);

    const [a, b] = await Promise.all([
      JobRunner.run({ queue, handlers: notificationJobHandlers, owner: "worker-a", random: () => 0 }),
      JobRunner.run({ queue, handlers: notificationJobHandlers, owner: "worker-b", random: () => 0 }),
    ]);

    // Between the two runs, the notice job was claimed exactly once — real
    // concurrency, real `FOR UPDATE SKIP LOCKED`, which only a real database
    // proves.
    expect(a.claimed + b.claimed).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.notification.count({
        where: {
          userId: reviewer.id,
          intent: NotificationIntent.ADMIN_COMPETITION_SUGGESTION,
        },
      }),
    ).toBe(1);
  });

  it("retries a transient failure and eventually succeeds, without duplicating the notification", async () => {
    const anchor = new Date();
    const submitter = await createActor(PlatformRole.USER, "submitter-retry");
    const reviewer = await createActor(PlatformRole.ADMIN, "reviewer-retry");

    const suggestion = await createSubmittedSuggestion({
      suffix: "retry",
      submittedById: submitter.id,
      ageSeconds: DELAY_SECONDS + 60,
      anchor,
    });

    await runDiscovery(anchor);

    // Simulates the state left behind by one real transient failure: an
    // attempt already burned, an error recorded, back to PENDING and due now
    // (`backoff.test.ts` and the generic job-runner tests already prove the
    // runner produces exactly this state on a thrown error; what this test
    // adds is that *this* handler, resumed from it, finishes cleanly and
    // without a second notification for the reviewer).
    const job = await prisma.notificationJob.findFirstOrThrow({
      where: { kind: "NOTIFY_ADMINS_OF_SUGGESTION", dedupeKey: { contains: suggestion.id } },
    });
    await prisma.notificationJob.update({
      where: { id: job.id },
      data: {
        status: "PENDING",
        attempts: 1,
        lastError: "simulated transient failure",
        runAt: new Date(),
      },
    });

    await drain();

    const finished = await prisma.notificationJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(finished.status).toBe("COMPLETED");
    expect(finished.attempts).toBe(2);

    expect(
      await prisma.notification.count({
        where: {
          userId: reviewer.id,
          intent: NotificationIntent.ADMIN_COMPETITION_SUGGESTION,
        },
      }),
    ).toBe(1);
  });
});

describe("admin suggestion notice — push delivery", () => {
  it("creates a settled WEB_PUSH delivery for a reviewer with an active push subscription", async () => {
    // The gap this closes: every other test in this file stops at "the
    // DELIVER_NOTIFICATION job exists" and explicitly defers push itself to
    // delivery.integration.test.ts — which never runs an actual
    // ADMIN_COMPETITION_SUGGESTION notification with a real subscription
    // through this intent's own discovery -> job -> handler wiring. This test
    // does: a reviewer with an ACTIVE PushSubscription, driven through the
    // real scheduler and the real job runner, must end up with a WEB_PUSH
    // delivery row that is settled (not left PENDING forever) — regardless of
    // whether the developer running the suite happens to have real Firebase
    // credentials configured, which is why the environment is pinned to
    // "unconfigured" for the duration of this one assertion.
    const anchor = new Date();
    const submitter = await createActor(PlatformRole.USER, "submitter-push");
    const reviewer = await createActor(PlatformRole.ADMIN, "reviewer-push");

    await prisma.pushSubscription.create({
      data: {
        userId: reviewer.id,
        token: unique("push-token"),
        userAgent: "vitest",
      },
    });

    await createSubmittedSuggestion({
      suffix: "push",
      submittedById: submitter.id,
      ageSeconds: DELAY_SECONDS + 60,
      anchor,
    });

    await runDiscovery(anchor);

    const savedFirebaseEnv = {
      FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
      FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
      FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,
    };
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
    resetPushProviderCache();

    try {
      await drain();
    } finally {
      for (const [key, value] of Object.entries(savedFirebaseEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      resetPushProviderCache();
    }

    const notification = await prisma.notification.findFirstOrThrow({
      where: {
        userId: reviewer.id,
        intent: NotificationIntent.ADMIN_COMPETITION_SUGGESTION,
      },
    });

    const pushDelivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { notificationId: notification.id, channel: "WEB_PUSH" },
    });

    // Unconfigured provider -> SKIPPED with a stated reason, never left
    // PENDING and never silently absent (delivery.service.ts's
    // skipUndeliverable path).
    expect(pushDelivery.status).toBe("SKIPPED");
    expect(pushDelivery.failureReason).toBe(
      "No push provider is configured in this environment",
    );
  });
});
