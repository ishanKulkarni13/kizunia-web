/**
 * Verifies push-subscription registration, listing and revocation against a
 * real database. `PushSubscriptionService` delegates to
 * `PushSubscriptionRepository`; these tests exercise the pair through the
 * service's public surface, matching how every sibling notification service
 * is tested in this module (real Postgres, no mocks).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { cleanupNotificationTestData } from "@/testing/notification-cleanup";

import { PushSubscriptionService } from "./push-subscription.service";

const PREFIX = "__vitest_push_subscription_test__";

function unique(name: string): string {
  return `${PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function createUser(suffix: string) {
  const id = unique(`user-${suffix}`);
  return prisma.user.create({
    data: {
      id,
      name: "Push Subscription Test User",
      email: `${id}@example.test`,
      emailVerified: true,
    },
  });
}

const cleanup = () => cleanupNotificationTestData(PREFIX);

beforeEach(cleanup);
afterEach(cleanup);

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("PushSubscriptionService", () => {
  it("registers a new subscription and never returns the raw token", async () => {
    const user = await createUser("register");
    const token = unique("token");

    const dto = await PushSubscriptionService.register({
      userId: user.id,
      token,
      userAgent: "vitest",
    });

    expect(dto.userAgent).toBe("vitest");
    expect(dto.status).toBe("ACTIVE");
    expect(dto).not.toHaveProperty("token");

    const row = await prisma.pushSubscription.findUniqueOrThrow({ where: { token } });
    expect(row.userId).toBe(user.id);
  });

  it("moves an existing token to whichever user registers it next", async () => {
    // A token identifies a browser, not a person — a shared machine re-used by
    // a different account must move the subscription, not reject it.
    const owner = await createUser("owner");
    const nextOwner = await createUser("next-owner");
    const token = unique("token");

    await PushSubscriptionService.register({ userId: owner.id, token });
    await PushSubscriptionService.register({ userId: nextOwner.id, token });

    const row = await prisma.pushSubscription.findUniqueOrThrow({ where: { token } });
    expect(row.userId).toBe(nextOwner.id);

    // The previous owner no longer sees it in their own list.
    const ownerSubscriptions = await PushSubscriptionService.listForUser(owner.id);
    expect(ownerSubscriptions).toHaveLength(0);
  });

  it("reactivates a previously invalid subscription on re-registration", async () => {
    const user = await createUser("reactivate");
    const token = unique("token");

    await PushSubscriptionService.register({ userId: user.id, token });
    await prisma.pushSubscription.update({
      where: { token },
      data: { status: "INVALID", consecutiveFailures: 5, invalidatedAt: new Date() },
    });

    const dto = await PushSubscriptionService.register({ userId: user.id, token });

    expect(dto.status).toBe("ACTIVE");
    const row = await prisma.pushSubscription.findUniqueOrThrow({ where: { token } });
    expect(row.consecutiveFailures).toBe(0);
    expect(row.invalidatedAt).toBeNull();
  });

  it("excludes revoked subscriptions from the user's list", async () => {
    const user = await createUser("list");
    const active = unique("active-token");
    const revoked = unique("revoked-token");

    const activeDto = await PushSubscriptionService.register({ userId: user.id, token: active });
    const revokedDto = await PushSubscriptionService.register({ userId: user.id, token: revoked });
    await PushSubscriptionService.revoke(user.id, revokedDto.id);

    const list = await PushSubscriptionService.listForUser(user.id);
    expect(list.map((s) => s.id)).toEqual([activeDto.id]);
  });

  it("revoke only affects the caller's own subscription", async () => {
    const owner = await createUser("revoke-owner");
    const other = await createUser("revoke-other");
    const token = unique("token");

    const dto = await PushSubscriptionService.register({ userId: owner.id, token });

    const revokedByOther = await PushSubscriptionService.revoke(other.id, dto.id);
    expect(revokedByOther).toBe(false);

    const stillActive = await prisma.pushSubscription.findUniqueOrThrow({ where: { token } });
    expect(stillActive.status).toBe("ACTIVE");

    const revokedByOwner = await PushSubscriptionService.revoke(owner.id, dto.id);
    expect(revokedByOwner).toBe(true);
  });

  it("revokeByToken is scoped to the caller the same way", async () => {
    const owner = await createUser("revoke-token-owner");
    const other = await createUser("revoke-token-other");
    const token = unique("token");

    await PushSubscriptionService.register({ userId: owner.id, token });

    expect(await PushSubscriptionService.revokeByToken(other.id, token)).toBe(false);
    expect(await PushSubscriptionService.revokeByToken(owner.id, token)).toBe(true);

    const row = await prisma.pushSubscription.findUniqueOrThrow({ where: { token } });
    expect(row.status).toBe("REVOKED");
  });
});
