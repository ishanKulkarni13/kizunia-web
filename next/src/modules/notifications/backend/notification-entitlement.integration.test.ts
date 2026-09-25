/**
 * Notification entitlement gating (Subscription Phase II, IB-2 / IB-7 / IB-16)
 * against a real database, driven by grants.
 *
 * Three enforcement points, one rule (`policy/intent-capability.ts`):
 *
 * 1. the scheduler's eligible-user query (set-based);
 * 2. the evaluation re-check (handler / `NotificationPolicyService`);
 * 3. the delivery re-check.
 *
 * What must hold throughout: a gated intent reaches only entitled users; there
 * is no admin bypass in the background; preferences are never read as
 * entitlement and never mutated by it; the recommendation engine stays
 * usable; intents that require no capability are untouched.
 *
 * Requires a reachable test database — see docs/testing/database.md.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PlatformRole } from "@/authorization/platform/roles";
import {
  CompetitionStatus,
  CompetitionVisibility,
  NotificationIntent,
  NotificationTargetType,
} from "@/generated/prisma";
import { Capability, hasCapability } from "@/lib/entitlements";
import { resetLogSink, setLogSink, type LogRecord } from "@/lib/logger";
import prisma from "@/lib/prisma";
import {
  agreementFixtures,
  grantPlanWithFixtureGranter,
  insertFixtureEntitlements,
  revokeGrants,
} from "@/testing/entitlement-fixtures";
import { cleanupNotificationTestData } from "@/testing/notification-cleanup";
import { DimensionId } from "@/modules/recommendations";
import { RecommendationService } from "@/modules/recommendations/backend/recommendation.service";

import { FakePushProvider } from "../delivery/fake-push-provider";
import { DeliveryService } from "../delivery/delivery.service";
import type { NotificationDraft } from "../content/notification-draft";
import { evaluateRegistrationClosingHandler } from "../jobs/handlers/evaluate-registration-closing.handler";
import { evaluateTopRelevantCompetitionHandler } from "../jobs/handlers/evaluate-top-relevant-competition.handler";
import { PostgresWorkQueue } from "../jobs/postgres-work-queue";
import { NotificationGenerationService } from "./notification-generation.service";
import { NotificationPolicyService } from "./notification-policy.service";
import { NotificationSchedulerService } from "./notification-scheduler.service";
import { NotificationService } from "./notification.service";

const PREFIX = "__vitest_notification_entitlement__";
const GRANTER = `${PREFIX}_fixture_granter`;
const ANCHOR = new Date("2026-09-17T13:00:00.000Z");
const queue = new PostgresWorkQueue();

const logs: LogRecord[] = [];

function unique(name: string): string {
  return `${PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function createUser(suffix: string, role: string = PlatformRole.USER) {
  const id = unique(`user-${suffix}`);

  return prisma.user.create({
    data: { id, name: "Entitlement Test User", email: `${id}@example.test`, emailVerified: true, role },
  });
}

async function enableIntent(userId: string, intent: NotificationIntent, enabled = true) {
  await prisma.notificationPreference.create({ data: { userId, intent, enabled } });
}

async function enableBoth(userId: string) {
  await enableIntent(userId, NotificationIntent.TOP_RELEVANT_COMPETITION);
  await enableIntent(userId, NotificationIntent.REGISTRATION_CLOSING);
}

async function preferFreeCompetitions(userId: string) {
  await prisma.competitionPreference.create({
    data: { userId, dimension: DimensionId.REGISTRATION_FEE_TYPE as never, value: "FREE", weight: 1 },
  });
}

async function createOpenCompetition(suffix: string) {
  return prisma.competition.create({
    data: {
      title: `Entitlement Test Competition ${suffix}`,
      slug: unique(`competition-${suffix}`),
      visibility: CompetitionVisibility.PUBLIC,
      status: CompetitionStatus.REGISTRATION_OPEN,
      registrationFeeType: "FREE",
      organizer: "Kizunia Test Org",
    },
  });
}

/** Users that have a scheduled evaluation job of `kind`, out of `userIds`. */
async function scheduledUsers(kind: "EVALUATE_TOP_RELEVANT_COMPETITION" | "EVALUATE_REGISTRATION_CLOSING", userIds: string[]) {
  const jobs = await prisma.notificationJob.findMany({
    where: { kind, dedupeKey: { startsWith: `${kind}:${PREFIX}` } },
    select: { dedupeKey: true },
  });

  return new Set(userIds.filter((id) => jobs.some((job) => job.dedupeKey.includes(id))));
}

async function schedule() {
  await NotificationSchedulerService.scheduleDueEvaluations({ queue, anchor: ANCHOR });
}

function evaluationContext<T extends object>(payload: T) {
  return { job: {} as never, payload, now: ANCHOR, queue } as never;
}

function suppressionsFor(userId: string) {
  return logs.filter((record) => record.event === "evaluation.suppressed" && record.fields.userId === userId);
}

function preferenceSnapshot(userId: string) {
  return prisma.notificationPreference.findMany({ where: { userId }, orderBy: { intent: "asc" } });
}

async function cleanup() {
  await cleanupNotificationTestData(PREFIX);
  await prisma.competition.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await prisma.notificationJob.deleteMany({});
  await cleanup();
});

beforeEach(() => {
  logs.length = 0;
  setLogSink((record) => {
    logs.push(record);
  });
});

afterEach(async () => {
  resetLogSink();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("scheduler — set-based entitlement filter", () => {
  it("schedules each gated intent only for users whose access includes its capability, agreeing with the per-user resolver", async () => {
    const users: { name: string; id: string }[] = [];

    for (const fixture of agreementFixtures(ANCHOR)) {
      const user = await createUser(fixture.name);
      users.push({ name: fixture.name, id: user.id });
      await enableBoth(user.id);
      await insertFixtureEntitlements(user.id, GRANTER_ID(), fixture);
    }

    await schedule();

    const ids = users.map((user) => user.id);
    const top = await scheduledUsers("EVALUATE_TOP_RELEVANT_COMPETITION", ids);
    const deadline = await scheduledUsers("EVALUATE_REGISTRATION_CLOSING", ids);

    // Agreement: exactly the users the per-user form says have the capability.
    for (const user of users) {
      expect(top.has(user.id), `${user.name}: TOP_RELEVANT_COMPETITION`).toBe(
        await hasCapability(user.id, Capability.RECOMMENDATIONS, { now: ANCHOR }),
      );
      expect(deadline.has(user.id), `${user.name}: REGISTRATION_CLOSING`).toBe(
        await hasCapability(user.id, Capability.DEADLINE_NOTIFICATIONS, { now: ANCHOR }),
      );
    }

    // And the concrete product rows, so the agreement is not vacuous.
    const named = (name: string) => users.find((user) => user.name === name)!.id;
    expect(top.has(named("plus"))).toBe(true);
    expect(top.has(named("pro"))).toBe(false);
    expect(deadline.has(named("pro"))).toBe(true);
    for (const none of ["free", "expired-plus", "future-plus", "revoked-plus"]) {
      expect(top.has(named(none)), none).toBe(false);
      expect(deadline.has(named(none)), none).toBe(false);
    }
  });

  it("does not schedule an administrator who holds no grant (no background bypass)", async () => {
    const admin = await createUser("admin", PlatformRole.SUPER_ADMIN);
    await enableBoth(admin.id);

    await schedule();

    expect((await scheduledUsers("EVALUATE_TOP_RELEVANT_COMPETITION", [admin.id])).size).toBe(0);
    expect((await scheduledUsers("EVALUATE_REGISTRATION_CLOSING", [admin.id])).size).toBe(0);
  });

  it("schedules an administrator once another administrator grants them access", async () => {
    const admin = await createUser("admin-granted", PlatformRole.ADMIN);
    await enableBoth(admin.id);
    await grantPlanWithFixtureGranter(admin.id, "PRO_PLUS", PREFIX);

    await schedule();

    expect((await scheduledUsers("EVALUATE_TOP_RELEVANT_COMPETITION", [admin.id])).size).toBe(1);
    expect((await scheduledUsers("EVALUATE_REGISTRATION_CLOSING", [admin.id])).size).toBe(1);
  });

  it("never changes a non-entitled user's stored preferences", async () => {
    const user = await createUser("free-prefs");
    await enableBoth(user.id);
    const before = await preferenceSnapshot(user.id);

    await schedule();

    expect(await preferenceSnapshot(user.id)).toEqual(before);
    expect(before.every((row) => row.enabled)).toBe(true);
  });

  it("picks a user up again as soon as they are granted access, with no other step", async () => {
    const user = await createUser("upgrade");
    await enableBoth(user.id);

    await schedule();
    expect((await scheduledUsers("EVALUATE_TOP_RELEVANT_COMPETITION", [user.id])).size).toBe(0);

    await grantPlanWithFixtureGranter(user.id, "PRO_PLUS", PREFIX);
    await schedule();

    expect((await scheduledUsers("EVALUATE_TOP_RELEVANT_COMPETITION", [user.id])).size).toBe(1);
  });
});

describe("evaluation re-check — TOP_RELEVANT_COMPETITION (recommendations, Pro+)", () => {
  const payloadFor = (userId: string, key: string) => ({
    userId,
    occurrenceKey: key,
    evaluatedAt: ANCHOR.toISOString(),
  });

  it("creates the notification for a PRO_PLUS user", async () => {
    const user = await createUser("plus");
    await enableIntent(user.id, NotificationIntent.TOP_RELEVANT_COMPETITION);
    await preferFreeCompetitions(user.id);
    await createOpenCompetition("plus");
    await grantPlanWithFixtureGranter(user.id, "PRO_PLUS", PREFIX);

    const result = await evaluateTopRelevantCompetitionHandler(evaluationContext(payloadFor(user.id, "top:plus")));

    expect(result.detail).toMatch(/^created:/);
  });

  it.each([
    ["FREE", null],
    ["PRO", "PRO" as const],
  ])("suppresses %s with NOT_ENTITLED and leaves the preference alone", async (_label, plan) => {
    const user = await createUser(`top-${_label.toLowerCase()}`);
    await enableIntent(user.id, NotificationIntent.TOP_RELEVANT_COMPETITION);
    await preferFreeCompetitions(user.id);
    await createOpenCompetition(_label);
    if (plan) await grantPlanWithFixtureGranter(user.id, plan, PREFIX);
    const before = await preferenceSnapshot(user.id);

    const result = await evaluateTopRelevantCompetitionHandler(evaluationContext(payloadFor(user.id, `top:${_label}`)));

    expect(result.detail).toBe("suppressed:NOT_ENTITLED");
    expect(suppressionsFor(user.id)).toMatchObject([
      { fields: { intent: "TOP_RELEVANT_COMPETITION", reason: "NOT_ENTITLED" } },
    ]);
    expect((await NotificationService.getInbox({ userId: user.id })).items).toHaveLength(0);
    expect(await preferenceSnapshot(user.id)).toEqual(before);
  });

  it("catches entitlement lost between scheduling and evaluation, and restores on regrant without a preference write", async () => {
    const user = await createUser("lost");
    await enableIntent(user.id, NotificationIntent.TOP_RELEVANT_COMPETITION);
    await preferFreeCompetitions(user.id);
    await createOpenCompetition("lost");
    await grantPlanWithFixtureGranter(user.id, "PRO_PLUS", PREFIX);

    await schedule();
    expect((await scheduledUsers("EVALUATE_TOP_RELEVANT_COMPETITION", [user.id])).size).toBe(1);

    // Downgrade after the job exists.
    await revokeGrants(user.id, GRANTER);
    const before = await preferenceSnapshot(user.id);

    const denied = await evaluateTopRelevantCompetitionHandler(evaluationContext(payloadFor(user.id, "top:lost")));
    expect(denied.detail).toBe("suppressed:NOT_ENTITLED");

    // Regrant: the same preference now produces the notification.
    await grantPlanWithFixtureGranter(user.id, "PRO_PLUS", PREFIX);
    const restored = await evaluateTopRelevantCompetitionHandler(evaluationContext(payloadFor(user.id, "top:restored")));
    expect(restored.detail).toMatch(/^created:/);
    expect(await preferenceSnapshot(user.id)).toEqual(before);
  });

  it("does not run the recommendation engine for a user who is not entitled, yet the engine itself stays usable", async () => {
    const user = await createUser("engine");
    await enableIntent(user.id, NotificationIntent.TOP_RELEVANT_COMPETITION);
    await preferFreeCompetitions(user.id);
    const competition = await createOpenCompetition("engine");

    const decision = await NotificationPolicyService.evaluateTopRelevantCompetition(user.id, ANCHOR);
    expect(decision).toMatchObject({ eligible: false, reason: "NOT_ENTITLED" });

    // The engine is shared infrastructure and is never gated: a FREE user's
    // recommendations still compute (the dev route and the Pro deadline
    // notification both depend on this).
    const result = await RecommendationService.generateForUser({ userId: user.id });
    expect(result.items.map((item) => item.competition.id)).toContain(competition.id);
  });

  it("does not let an administrator without a grant through", async () => {
    const admin = await createUser("top-admin", PlatformRole.SUPER_ADMIN);
    await enableIntent(admin.id, NotificationIntent.TOP_RELEVANT_COMPETITION);
    await preferFreeCompetitions(admin.id);
    await createOpenCompetition("admin");

    const result = await evaluateTopRelevantCompetitionHandler(evaluationContext(payloadFor(admin.id, "top:admin")));

    expect(result.detail).toBe("suppressed:NOT_ENTITLED");
  });
});

describe("evaluation re-check — REGISTRATION_CLOSING (deadline notifications, Pro)", () => {
  const payloadFor = (userId: string, key: string) => ({
    userId,
    occurrenceKey: key,
    evaluatedAt: ANCHOR.toISOString(),
    // An empty band: an entitled user then reaches NO_SUBJECTS_IN_WINDOW, which
    // proves the entitlement check passed without needing deadline fixtures.
    windowStart: new Date("2020-01-01T00:00:00.000Z").toISOString(),
    windowEnd: new Date("2020-01-02T00:00:00.000Z").toISOString(),
  });

  it("suppresses a FREE user with NOT_ENTITLED, before looking at any competition", async () => {
    const user = await createUser("deadline-free");
    await enableIntent(user.id, NotificationIntent.REGISTRATION_CLOSING);
    const before = await preferenceSnapshot(user.id);

    const result = await evaluateRegistrationClosingHandler(evaluationContext(payloadFor(user.id, "deadline:free")));

    expect(result.detail).toBe("suppressed:NOT_ENTITLED");
    expect(suppressionsFor(user.id)).toMatchObject([
      { fields: { intent: "REGISTRATION_CLOSING", reason: "NOT_ENTITLED" } },
    ]);
    expect(await preferenceSnapshot(user.id)).toEqual(before);
  });

  it.each(["PRO", "PRO_PLUS"] as const)("lets a %s user past the entitlement check", async (plan) => {
    const user = await createUser(`deadline-${plan}`);
    await enableIntent(user.id, NotificationIntent.REGISTRATION_CLOSING);
    await grantPlanWithFixtureGranter(user.id, plan, PREFIX);

    const result = await evaluateRegistrationClosingHandler(evaluationContext(payloadFor(user.id, `deadline:${plan}`)));

    expect(result.detail).toBe("suppressed:NO_SUBJECTS_IN_WINDOW");
  });

  it("does not let an administrator without a grant through", async () => {
    const admin = await createUser("deadline-admin", PlatformRole.ADMIN);
    await enableIntent(admin.id, NotificationIntent.REGISTRATION_CLOSING);

    const result = await evaluateRegistrationClosingHandler(evaluationContext(payloadFor(admin.id, "deadline:admin")));

    expect(result.detail).toBe("suppressed:NOT_ENTITLED");
  });

  it("still reports a disabled preference as INTENT_DISABLED, not NOT_ENTITLED", async () => {
    const user = await createUser("deadline-disabled");
    await enableIntent(user.id, NotificationIntent.REGISTRATION_CLOSING, false);

    const result = await evaluateRegistrationClosingHandler(evaluationContext(payloadFor(user.id, "deadline:off")));

    expect(result.detail).toBe("suppressed:INTENT_DISABLED");
  });
});

describe("delivery re-check", () => {
  const noJitter = () => 0;

  function draftFor(userId: string, intent: NotificationIntent, occurrenceKey: string): NotificationDraft {
    return {
      userId,
      intent,
      occurrenceKey,
      title: "A notification",
      body: "Something worth a look.",
      actionPath: "/competitions/example",
      payload: null,
      targets: [
        { targetType: NotificationTargetType.COMPETITION, targetId: "comp-a", targetVersion: null, rank: 1 },
      ],
    };
  }

  async function generate(userId: string, intent: NotificationIntent, key: string): Promise<string> {
    const outcome = await NotificationGenerationService.generate(draftFor(userId, intent, key), ANCHOR);
    if (!outcome.created) throw new Error("expected a fresh notification");
    return outcome.notificationId;
  }

  async function subscribe(userId: string) {
    await prisma.pushSubscription.create({ data: { userId, token: unique("token"), userAgent: "vitest" } });
  }

  it("sends to a user who still holds the capability", async () => {
    const user = await createUser("delivery-ok");
    await enableIntent(user.id, NotificationIntent.TOP_RELEVANT_COMPETITION);
    await grantPlanWithFixtureGranter(user.id, "PRO_PLUS", PREFIX);
    await subscribe(user.id);
    const notificationId = await generate(user.id, NotificationIntent.TOP_RELEVANT_COMPETITION, "top:ok");

    const provider = new FakePushProvider({ canDeliver: true });
    const summary = await DeliveryService.deliver({ notificationId, provider, now: ANCHOR, random: noJitter });

    expect(summary.accepted).toBe(1);
    expect(provider.callCount).toBe(1);
  });

  it("skips the push, keeps the inbox entry and the preference, when the capability was lost after generation", async () => {
    const user = await createUser("delivery-lost");
    await enableIntent(user.id, NotificationIntent.TOP_RELEVANT_COMPETITION);
    await grantPlanWithFixtureGranter(user.id, "PRO_PLUS", PREFIX);
    await subscribe(user.id);
    const notificationId = await generate(user.id, NotificationIntent.TOP_RELEVANT_COMPETITION, "top:lost");

    await revokeGrants(user.id, GRANTER);
    const before = await preferenceSnapshot(user.id);

    const provider = new FakePushProvider({ canDeliver: true });
    const summary = await DeliveryService.deliver({ notificationId, provider, now: ANCHOR, random: noJitter });

    expect(provider.callCount).toBe(0);
    expect(summary.accepted).toBe(0);

    // Nothing was recorded as sent. (Delivery rows are created lazily, so
    // there may be none at all; if one exists it must be a deliberate SKIPPED,
    // never a SENT or FAILED.)
    const deliveries = await prisma.notificationDelivery.findMany({
      where: { notificationId, channel: "WEB_PUSH" },
    });
    expect(deliveries.every((delivery) => delivery.status === "SKIPPED")).toBe(true);

    expect(
      logs.some(
        (record) =>
          record.event === "delivery.skipped" &&
          record.fields.notificationId === notificationId &&
          record.fields.reason === "NOT_ENTITLED",
      ),
    ).toBe(true);

    // History is not rewritten: the notification is still in the inbox, and
    // the user's preference is untouched.
    expect((await NotificationService.getInbox({ userId: user.id })).items).toHaveLength(1);
    expect(await preferenceSnapshot(user.id)).toEqual(before);
  });

  it("skips a PRO user's TOP_RELEVANT_COMPETITION push but not their REGISTRATION_CLOSING push", async () => {
    const user = await createUser("delivery-pro");
    await enableIntent(user.id, NotificationIntent.TOP_RELEVANT_COMPETITION);
    await enableIntent(user.id, NotificationIntent.REGISTRATION_CLOSING);
    await grantPlanWithFixtureGranter(user.id, "PRO", PREFIX);
    await subscribe(user.id);

    const top = await generate(user.id, NotificationIntent.TOP_RELEVANT_COMPETITION, "top:pro");
    const deadline = await generate(user.id, NotificationIntent.REGISTRATION_CLOSING, "deadline:pro");

    const topProvider = new FakePushProvider({ canDeliver: true });
    await DeliveryService.deliver({ notificationId: top, provider: topProvider, now: ANCHOR, random: noJitter });
    expect(topProvider.callCount).toBe(0);

    const deadlineProvider = new FakePushProvider({ canDeliver: true });
    await DeliveryService.deliver({ notificationId: deadline, provider: deadlineProvider, now: ANCHOR, random: noJitter });
    expect(deadlineProvider.callCount).toBe(1);
  });

  it("leaves an ungated intent untouched: FEATURE_ANNOUNCEMENT is delivered to a FREE user", async () => {
    const user = await createUser("delivery-announcement");
    await subscribe(user.id);
    const notificationId = await generate(user.id, NotificationIntent.FEATURE_ANNOUNCEMENT, "announcement:1");

    const provider = new FakePushProvider({ canDeliver: true });
    const summary = await DeliveryService.deliver({ notificationId, provider, now: ANCHOR, random: noJitter });

    expect(summary.accepted).toBe(1);
    expect(provider.callCount).toBe(1);
  });

  it("does not consult entitlement for an admin without a grant: gated notifications are skipped for them too", async () => {
    const admin = await createUser("delivery-admin", PlatformRole.SUPER_ADMIN);
    await enableIntent(admin.id, NotificationIntent.TOP_RELEVANT_COMPETITION);
    await subscribe(admin.id);
    const notificationId = await generate(admin.id, NotificationIntent.TOP_RELEVANT_COMPETITION, "top:admin");

    const provider = new FakePushProvider({ canDeliver: true });
    await DeliveryService.deliver({ notificationId, provider, now: ANCHOR, random: noJitter });

    expect(provider.callCount).toBe(0);
  });
});

/** The fixture granter that `grantPlanWithFixtureGranter` provisions, created on demand. */
function GRANTER_ID(): string {
  return GRANTER;
}
