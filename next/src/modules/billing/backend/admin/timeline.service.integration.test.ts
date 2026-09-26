/**
 * Admin billing timeline (Phase VIII): history, operations, events and money
 * facts for a user or one subscription, newest first — and never a raw
 * provider payload, for any role (IB-28 item 4).
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { PlatformRole } from "@/authorization";
import { ForbiddenError } from "@/lib/errors";
import prisma from "@/lib/prisma";
import {
  actorWithRole,
  captureLogs,
  insertBillingEvent,
  insertHistoryEntry,
  insertMoneyFact,
} from "@/testing/billing-admin-fixtures";
import {
  cleanupBillingUsers,
  createBillingUser,
  insertBoundSubscription,
  insertOperation,
} from "@/testing/billing-sync-fixtures";

import { BillingUserNotFoundError, SubscriptionNotFoundError } from "../../errors";
import { TimelineRepository } from "./timeline.repository";
import { AdminTimelineService } from "./timeline.service";

const PREFIX = "__vitest_billing_admin_timeline__";
const SECRET = "SENTINEL-customer-contact-9f3a@example.test";

const service = new AdminTimelineService();

afterEach(async () => {
  await cleanupBillingUsers(PREFIX);
});
afterAll(async () => {
  await cleanupBillingUsers(PREFIX);
  await prisma.$disconnect();
});

async function scene() {
  const userId = await createBillingUser(PREFIX, "subject");
  const sub = await insertBoundSubscription(userId);
  const other = await insertBoundSubscription(userId, { phase: "CANCELLED" });

  const history = await insertHistoryEntry(sub.id, userId, { recordedAt: new Date("2026-09-01T00:00:00.000Z") });
  const operation = await insertOperation(userId, {
    subscriptionId: sub.id,
    createdAt: new Date("2026-09-02T00:00:00.000Z"),
    request: { atCycleEnd: false, reason: "ADMIN_CANCEL", note: "duplicate charge", contact: SECRET },
  });
  const event = await insertBillingEvent(PREFIX, {
    subscriptionId: sub.id,
    providerSubscriptionId: sub.providerSubscriptionId,
    receivedAt: new Date("2026-09-03T00:00:00.000Z"),
    rawPayload: { payload: { customer_email: SECRET } },
  });
  // Recorded before its subscription was matched: found by provider subscription id.
  const unmatched = await insertBillingEvent(PREFIX, {
    providerSubscriptionId: sub.providerSubscriptionId,
    status: "UNMATCHED",
    receivedAt: new Date("2026-09-04T00:00:00.000Z"),
    rawPayload: { payload: { customer_contact: SECRET } },
  });
  const fact = await insertMoneyFact(PREFIX, {
    subscriptionId: sub.id,
    userId,
    billingEventId: event.id,
    occurredAt: new Date("2026-09-05T00:00:00.000Z"),
  });
  const otherHistory = await insertHistoryEntry(other.id, userId, {
    toValue: "CANCELLED",
    recordedAt: new Date("2026-09-06T00:00:00.000Z"),
  });

  return { userId, sub, other, history, operation, event, unmatched, fact, otherHistory };
}

describe("AdminTimelineService", () => {
  it("merges all four sources for a user, newest first, with the payload left out", async () => {
    const s = await scene();
    const admin = await actorWithRole(PREFIX, PlatformRole.ADMIN);

    const timeline = await service.forUser(admin, s.userId);

    expect(timeline.entries.map((e) => [e.kind, e.id])).toEqual([
      ["HISTORY", s.otherHistory.id],
      ["MONEY_FACT", s.fact.id],
      ["EVENT", s.unmatched.id],
      ["EVENT", s.event.id],
      ["OPERATION", s.operation.id],
      ["HISTORY", s.history.id],
    ]);
    expect(timeline.subscriptions.map((sub) => sub.id).sort()).toEqual([s.sub.id, s.other.id].sort());
    expect(timeline.truncated).toBe(false);

    const event = timeline.entries.find((e) => e.id === s.event.id);
    expect(event).toMatchObject({
      kind: "EVENT",
      hasPayload: true,
      providerEventId: s.event.dedupeKey,
      providerSubscriptionId: s.sub.providerSubscriptionId,
    });

    const operation = timeline.entries.find((e) => e.id === s.operation.id);
    // Only whitelisted request fields are shown.
    expect(operation).toMatchObject({
      kind: "OPERATION",
      request: { atCycleEnd: false, reason: "ADMIN_CANCEL", note: "duplicate charge" },
    });

    expect(JSON.stringify(timeline)).not.toContain(SECRET);
    expect(JSON.stringify(timeline)).not.toContain("rawPayload");
  });

  it("never carries a payload even for a SUPER_ADMIN", async () => {
    const s = await scene();
    const superAdmin = await actorWithRole(PREFIX, PlatformRole.SUPER_ADMIN);

    const timeline = await service.forUser(superAdmin, s.userId);

    expect(timeline.permissions.canViewRawPayloads).toBe(true);
    expect(JSON.stringify(timeline)).not.toContain(SECRET);
  });

  it("scopes a subscription timeline to that subscription", async () => {
    const s = await scene();
    const admin = await actorWithRole(PREFIX, PlatformRole.ADMIN);

    const timeline = await service.forSubscription(admin, s.other.id);

    expect(timeline.subscriptionId).toBe(s.other.id);
    expect(timeline.entries.map((e) => e.id)).toEqual([s.otherHistory.id]);
  });

  it("excludes another user's rows", async () => {
    const s = await scene();
    const stranger = await createBillingUser(PREFIX, "stranger");
    const admin = await actorWithRole(PREFIX, PlatformRole.ADMIN);

    const timeline = await service.forUser(admin, stranger);

    expect(timeline.entries).toEqual([]);
    expect(timeline.entries.some((e) => e.id === s.event.id)).toBe(false);
  });

  it("reports a pruned payload as not retained", async () => {
    const s = await scene();
    await prisma.billingEvent.update({
      where: { id: s.event.id },
      data: { rawPayload: undefined, payloadPrunedAt: new Date("2026-09-10T00:00:00.000Z") },
    });
    await prisma.$executeRaw`UPDATE "public"."billing_event" SET "rawPayload" = NULL WHERE "id" = ${s.event.id}`;

    const timeline = await service.forUser(await actorWithRole(PREFIX, PlatformRole.ADMIN), s.userId);

    expect(timeline.entries.find((e) => e.id === s.event.id)).toMatchObject({
      hasPayload: false,
      payloadPrunedAt: "2026-09-10T00:00:00.000Z",
    });
  });

  it("caps each source and says so", async () => {
    const s = await scene();
    const repository = new TimelineRepository();

    const history = await repository.history(
      { userId: s.userId, subscriptionIds: [s.sub.id, s.other.id], providerSubscriptionIds: [] },
      1,
    );

    expect(history.rows).toHaveLength(1);
    expect(history.truncated).toBe(true);
  });

  it("logs nothing that contains a payload", async () => {
    const s = await scene();
    const logs = await captureLogs();

    try {
      await service.forUser(await actorWithRole(PREFIX, PlatformRole.SUPER_ADMIN), s.userId);
    } finally {
      logs.stop();
    }

    expect(logs.text()).not.toContain(SECRET);
  });

  it("refuses MODERATOR and USER, and 404s unknown subjects", async () => {
    const s = await scene();

    for (const role of [PlatformRole.MODERATOR, PlatformRole.USER]) {
      const actor = await actorWithRole(PREFIX, role);
      await expect(service.forUser(actor, s.userId)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(service.forSubscription(actor, s.sub.id)).rejects.toBeInstanceOf(ForbiddenError);
    }

    const admin = await actorWithRole(PREFIX, PlatformRole.ADMIN);
    await expect(service.forUser(admin, `${PREFIX}missing`)).rejects.toBeInstanceOf(BillingUserNotFoundError);
    await expect(service.forSubscription(admin, `${PREFIX}missing`)).rejects.toBeInstanceOf(
      SubscriptionNotFoundError,
    );
  });
});
