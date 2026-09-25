/**
 * Verifies `NotificationPreferenceService`'s default-state, audience and update
 * behavior against a real Postgres database, and confirms user isolation.
 *
 * Requires a reachable test database — see docs/testing/database.md. Fails
 * loudly rather than skipping if `DATABASE_TEST_URL` is not configured for
 * a real database, matching this repo's other integration tests.
 */
import { afterAll, describe, expect, it } from "vitest";

import type { StrictAuthorizationActor } from "@/authorization";
import { PlatformRole } from "@/authorization/platform/roles";
import prisma from "@/lib/prisma";
import { NotificationIntent } from "@/generated/prisma";
import {
  deleteGrantsForEmailPrefix,
  grantPlanWithFixtureGranter,
  revokeGrants,
} from "@/testing/entitlement-fixtures";

import { NotificationPreferenceService } from "./notification-preference.service";

const TEST_EMAIL_PREFIX = "__vitest_notification_preference_test__";

function testEmail(name: string): string {
  return `${TEST_EMAIL_PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

/**
 * A user plus the actor that stands for them.
 *
 * The service resolves the role from the database rather than trusting the
 * actor, so the row is what actually decides the audience — but the actor is
 * still what callers pass, and constructing both together keeps the two from
 * drifting apart inside a test.
 */
async function createTestUser(
  nameSuffix: string,
  role: PlatformRole = PlatformRole.USER,
): Promise<{ id: string; actor: StrictAuthorizationActor }> {
  const user = await prisma.user.create({
    data: {
      id: `notif-pref-test-${nameSuffix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      name: "Notification Preference Test User",
      email: testEmail(nameSuffix),
      emailVerified: true,
      role,
    },
  });

  return {
    id: user.id,
    actor: { id: user.id, role, banned: false },
  };
}

afterAll(async () => {
  await prisma.notificationPreference.deleteMany({
    where: { user: { email: { startsWith: TEST_EMAIL_PREFIX } } },
  });
  await deleteGrantsForEmailPrefix(TEST_EMAIL_PREFIX);
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_EMAIL_PREFIX } } });
  await prisma.$disconnect();
});

describe("NotificationPreferenceService", () => {
  it("reports every applicable intent at its own default for a user with no rows", async () => {
    const user = await createTestUser("default-state");

    const preferences = await NotificationPreferenceService.getForUser(user.actor);

    // Defaults are per-intent, not one global default (ND-P-16): intents that
    // act on inferred relevance are opt-in, editorial announcements are not.
    //
    // A FREE user is not entitled to the two paid intents, and the DTO says so
    // and names the plan (IB-16) — while still reporting the stored/default
    // preference untouched.
    expect(preferences).toEqual([
      {
        intent: NotificationIntent.TOP_RELEVANT_COMPETITION,
        enabled: false,
        entitled: false,
        requiredPlan: "PRO_PLUS",
      },
      {
        intent: NotificationIntent.REGISTRATION_CLOSING,
        enabled: false,
        entitled: false,
        requiredPlan: "PRO",
      },
      {
        intent: NotificationIntent.FEATURE_ANNOUNCEMENT,
        enabled: true,
        entitled: true,
        requiredPlan: null,
      },
    ]);
  });

  it("omits the reviewer-only intent for an ordinary member", async () => {
    const user = await createTestUser("audience-member");

    const preferences = await NotificationPreferenceService.getForUser(user.actor);

    // A setting that cannot affect what you receive is worse than an absent
    // one: the recipient query selects on the review permission, so this toggle
    // would control nothing whichever way a member set it.
    expect(preferences.map((preference) => preference.intent)).not.toContain(
      NotificationIntent.ADMIN_COMPETITION_SUGGESTION,
    );
  });

  it("includes the reviewer-only intent, defaulting on, for an admin", async () => {
    const admin = await createTestUser("audience-admin", PlatformRole.ADMIN);

    const preferences = await NotificationPreferenceService.getForUser(admin.actor);

    // Operational and default-on: someone responsible for the review queue
    // should hear about work arriving in it without first discovering a setting.
    expect(preferences).toContainEqual({
      intent: NotificationIntent.ADMIN_COMPETITION_SUGGESTION,
      enabled: true,
      entitled: true,
      requiredPlan: null,
    });
  });

  it("reports one entry per applicable intent, never omitting one", async () => {
    const admin = await createTestUser("exhaustive", PlatformRole.SUPER_ADMIN);

    const preferences = await NotificationPreferenceService.getForUser(admin.actor);

    // A client must never have to distinguish "missing row" from "set to
    // false". For an actor every intent applies to, that means the full enum —
    // asserting against the enum itself rather than a hard-coded list means
    // adding an intent fails here only if the service genuinely stops covering
    // it.
    expect(preferences.map((preference) => preference.intent)).toEqual(
      Object.values(NotificationIntent),
    );
  });

  it("refuses to set an intent that does not apply to the actor", async () => {
    const user = await createTestUser("audience-write");

    await expect(
      NotificationPreferenceService.update(
        user.actor,
        NotificationIntent.ADMIN_COMPETITION_SUGGESTION,
        true,
      ),
    ).rejects.toThrow(/does not apply/i);

    // And nothing was written. A rejected write that still left a row would be
    // the worse failure, because the read path would never surface it.
    const count = await prisma.notificationPreference.count({
      where: {
        userId: user.id,
        intent: NotificationIntent.ADMIN_COMPETITION_SUGGESTION,
      },
    });
    expect(count).toBe(0);
  });

  it("lets a reviewer opt out of the operational intent", async () => {
    const admin = await createTestUser("audience-optout", PlatformRole.ADMIN);

    await NotificationPreferenceService.update(
      admin.actor,
      NotificationIntent.ADMIN_COMPETITION_SUGGESTION,
      false,
    );

    expect(
      await NotificationPreferenceService.isEnabledForUser(
        admin.id,
        NotificationIntent.ADMIN_COMPETITION_SUGGESTION,
      ),
    ).toBe(false);
  });

  it("isEnabledForUser resolves the default without needing an actor", async () => {
    const user = await createTestUser("worker-read");

    // The question a background worker asks. It must not consult the audience,
    // which has already been settled by whatever selected the recipient.
    expect(
      await NotificationPreferenceService.isEnabledForUser(
        user.id,
        NotificationIntent.FEATURE_ANNOUNCEMENT,
      ),
    ).toBe(true);
    expect(
      await NotificationPreferenceService.isEnabledForUser(
        user.id,
        NotificationIntent.TOP_RELEVANT_COMPETITION,
      ),
    ).toBe(false);
  });

  it("enables an intent", async () => {
    const user = await createTestUser("enable");

    await NotificationPreferenceService.update(
      user.actor,
      NotificationIntent.TOP_RELEVANT_COMPETITION,
      true,
    );

    const preferences = await NotificationPreferenceService.getForUser(user.actor);
    expect(preferences).toContainEqual(
      expect.objectContaining({
        intent: NotificationIntent.TOP_RELEVANT_COMPETITION,
        enabled: true,
      }),
    );
  });

  it("disables a previously enabled intent", async () => {
    const user = await createTestUser("disable");

    await NotificationPreferenceService.update(
      user.actor,
      NotificationIntent.TOP_RELEVANT_COMPETITION,
      true,
    );
    await NotificationPreferenceService.update(
      user.actor,
      NotificationIntent.TOP_RELEVANT_COMPETITION,
      false,
    );

    const preferences = await NotificationPreferenceService.getForUser(user.actor);
    expect(preferences).toContainEqual(
      expect.objectContaining({
        intent: NotificationIntent.TOP_RELEVANT_COMPETITION,
        enabled: false,
      }),
    );
  });

  it("update is idempotent — upserting the same state twice leaves one row", async () => {
    const user = await createTestUser("idempotent");

    await NotificationPreferenceService.update(
      user.actor,
      NotificationIntent.TOP_RELEVANT_COMPETITION,
      true,
    );
    await NotificationPreferenceService.update(
      user.actor,
      NotificationIntent.TOP_RELEVANT_COMPETITION,
      true,
    );

    const count = await prisma.notificationPreference.count({ where: { userId: user.id } });
    expect(count).toBe(1);
  });

  it("keeps two users' preferences fully isolated", async () => {
    const userA = await createTestUser("isolation-a");
    const userB = await createTestUser("isolation-b");

    await NotificationPreferenceService.update(
      userA.actor,
      NotificationIntent.TOP_RELEVANT_COMPETITION,
      true,
    );

    const preferencesA = await NotificationPreferenceService.getForUser(userA.actor);
    const preferencesB = await NotificationPreferenceService.getForUser(userB.actor);

    expect(preferencesA).toContainEqual(
      expect.objectContaining({
        intent: NotificationIntent.TOP_RELEVANT_COMPETITION,
        enabled: true,
      }),
    );
    expect(preferencesB).toContainEqual(
      expect.objectContaining({
        intent: NotificationIntent.TOP_RELEVANT_COMPETITION,
        enabled: false,
      }),
    );
  });
});

describe("NotificationPreferenceService — entitlement (IB-16)", () => {
  const byIntent = (
    preferences: Awaited<ReturnType<typeof NotificationPreferenceService.getForUser>>,
    intent: NotificationIntent,
  ) => preferences.find((preference) => preference.intent === intent);

  it("always stores a toggle for an intent the user is not entitled to, and reports entitled: false", async () => {
    const user = await createTestUser("free-toggle");

    const saved = await NotificationPreferenceService.update(
      user.actor,
      NotificationIntent.TOP_RELEVANT_COMPETITION,
      true,
    );

    expect(saved).toEqual({
      intent: NotificationIntent.TOP_RELEVANT_COMPETITION,
      enabled: true,
      entitled: false,
      requiredPlan: "PRO_PLUS",
    });
    expect(
      await NotificationPreferenceService.isEnabledForUser(
        user.id,
        NotificationIntent.TOP_RELEVANT_COMPETITION,
      ),
    ).toBe(true);
    expect(
      await prisma.notificationPreference.count({
        where: { userId: user.id, intent: NotificationIntent.TOP_RELEVANT_COMPETITION, enabled: true },
      }),
    ).toBe(1);
  });

  it("reports PRO as entitled to deadline notifications but not to recommendations", async () => {
    const user = await createTestUser("pro");
    await grantPlanWithFixtureGranter(user.id, "PRO", TEST_EMAIL_PREFIX);

    const preferences = await NotificationPreferenceService.getForUser(user.actor);

    expect(byIntent(preferences, NotificationIntent.REGISTRATION_CLOSING)?.entitled).toBe(true);
    expect(byIntent(preferences, NotificationIntent.TOP_RELEVANT_COMPETITION)?.entitled).toBe(false);
    expect(byIntent(preferences, NotificationIntent.FEATURE_ANNOUNCEMENT)?.entitled).toBe(true);
  });

  it("reports PRO_PLUS as entitled to every intent", async () => {
    const user = await createTestUser("plus");
    await grantPlanWithFixtureGranter(user.id, "PRO_PLUS", TEST_EMAIL_PREFIX);

    const preferences = await NotificationPreferenceService.getForUser(user.actor);

    expect(preferences.every((preference) => preference.entitled)).toBe(true);
  });

  it("does not report an admin as entitled just for being an admin (no bypass in the background)", async () => {
    const admin = await createTestUser("admin", PlatformRole.ADMIN);

    const preferences = await NotificationPreferenceService.getForUser(admin.actor);

    expect(byIntent(preferences, NotificationIntent.TOP_RELEVANT_COMPETITION)?.entitled).toBe(false);
    expect(byIntent(preferences, NotificationIntent.REGISTRATION_CLOSING)?.entitled).toBe(false);
  });

  it("leaves stored preferences exactly as they were when entitlement is lost and regained", async () => {
    const user = await createTestUser("downgrade");
    await grantPlanWithFixtureGranter(user.id, "PRO_PLUS", TEST_EMAIL_PREFIX);
    await NotificationPreferenceService.update(user.actor, NotificationIntent.TOP_RELEVANT_COMPETITION, true);
    await NotificationPreferenceService.update(user.actor, NotificationIntent.REGISTRATION_CLOSING, true);

    const snapshot = () =>
      prisma.notificationPreference.findMany({
        where: { userId: user.id },
        orderBy: { intent: "asc" },
      });
    const before = await snapshot();

    await revokeGrants(user.id, `${TEST_EMAIL_PREFIX}_fixture_granter`);

    const during = await NotificationPreferenceService.getForUser(user.actor);
    expect(byIntent(during, NotificationIntent.TOP_RELEVANT_COMPETITION)).toMatchObject({
      enabled: true,
      entitled: false,
    });
    expect(byIntent(during, NotificationIntent.REGISTRATION_CLOSING)).toMatchObject({
      enabled: true,
      entitled: false,
    });
    expect(await snapshot()).toEqual(before);

    await grantPlanWithFixtureGranter(user.id, "PRO_PLUS", TEST_EMAIL_PREFIX);

    const after = await NotificationPreferenceService.getForUser(user.actor);
    expect(byIntent(after, NotificationIntent.TOP_RELEVANT_COMPETITION)).toMatchObject({
      enabled: true,
      entitled: true,
    });
    expect(await snapshot()).toEqual(before);
  });
});
