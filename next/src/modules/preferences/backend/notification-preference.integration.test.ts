/**
 * Verifies `NotificationPreferenceService`'s default-state and update
 * behavior against a real Postgres database, and confirms user isolation.
 *
 * Requires a reachable test database — see docs/testing/database.md. Fails
 * loudly rather than skipping if `DATABASE_TEST_URL` is not configured for
 * a real database, matching this repo's other integration tests.
 */
import { afterAll, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { NotificationIntent } from "@/generated/prisma";

import { NotificationPreferenceService } from "./notification-preference.service";

const TEST_EMAIL_PREFIX = "__vitest_notification_preference_test__";

function testEmail(name: string): string {
  return `${TEST_EMAIL_PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

async function createTestUser(nameSuffix: string) {
  return prisma.user.create({
    data: {
      id: `notif-pref-test-${nameSuffix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      name: "Notification Preference Test User",
      email: testEmail(nameSuffix),
      emailVerified: true,
    },
  });
}

afterAll(async () => {
  await prisma.notificationPreference.deleteMany({
    where: { user: { email: { startsWith: TEST_EMAIL_PREFIX } } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_EMAIL_PREFIX } } });
  await prisma.$disconnect();
});

describe("NotificationPreferenceService", () => {
  it("defaults a user with no row to disabled for every known intent", async () => {
    const user = await createTestUser("default-state");

    const preferences = await NotificationPreferenceService.getForUser(user.id);

    expect(preferences).toEqual([
      { intent: NotificationIntent.TOP_RELEVANT_COMPETITION, enabled: false },
    ]);
  });

  it("enables an intent", async () => {
    const user = await createTestUser("enable");

    await NotificationPreferenceService.update(
      user.id,
      NotificationIntent.TOP_RELEVANT_COMPETITION,
      true,
    );

    const preferences = await NotificationPreferenceService.getForUser(user.id);
    expect(preferences).toContainEqual({
      intent: NotificationIntent.TOP_RELEVANT_COMPETITION,
      enabled: true,
    });
  });

  it("disables a previously enabled intent", async () => {
    const user = await createTestUser("disable");

    await NotificationPreferenceService.update(
      user.id,
      NotificationIntent.TOP_RELEVANT_COMPETITION,
      true,
    );
    await NotificationPreferenceService.update(
      user.id,
      NotificationIntent.TOP_RELEVANT_COMPETITION,
      false,
    );

    const preferences = await NotificationPreferenceService.getForUser(user.id);
    expect(preferences).toContainEqual({
      intent: NotificationIntent.TOP_RELEVANT_COMPETITION,
      enabled: false,
    });
  });

  it("update is idempotent — upserting the same state twice leaves one row", async () => {
    const user = await createTestUser("idempotent");

    await NotificationPreferenceService.update(
      user.id,
      NotificationIntent.TOP_RELEVANT_COMPETITION,
      true,
    );
    await NotificationPreferenceService.update(
      user.id,
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
      userA.id,
      NotificationIntent.TOP_RELEVANT_COMPETITION,
      true,
    );

    const preferencesA = await NotificationPreferenceService.getForUser(userA.id);
    const preferencesB = await NotificationPreferenceService.getForUser(userB.id);

    expect(preferencesA).toContainEqual({
      intent: NotificationIntent.TOP_RELEVANT_COMPETITION,
      enabled: true,
    });
    expect(preferencesB).toContainEqual({
      intent: NotificationIntent.TOP_RELEVANT_COMPETITION,
      enabled: false,
    });
  });
});
