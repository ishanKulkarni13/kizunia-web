/**
 * The sync-due marker and claims, against real Postgres: coalescing, the
 * terminal and unbound exclusions, exclusive claims, lease expiry, the mode
 * filter, the targeted claim, and UTC binding.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { cleanupBillingUsers, createBillingUser, insertBoundSubscription } from "@/testing/billing-sync-fixtures";

import { SyncClaimRepository } from "./claim.repository";

const PREFIX = "__vitest_billing_claim__";
const NOW = new Date("2026-10-01T12:00:00.000Z");
const MIN = 60 * 1000;
const at = (minutes: number) => new Date(NOW.getTime() + minutes * MIN);

async function subscriptions(overrides: Parameters<typeof insertBoundSubscription>[1][] = [{}]) {
  const userId = await createBillingUser(PREFIX);

  return Promise.all(overrides.map((o) => insertBoundSubscription(userId, o)));
}

/** Claims restricted to this suite's rows, since other suites may leave due TEST rows. */
async function claimOurs(now: Date, limit = 50, leaseSeconds = 60) {
  const claimed = await SyncClaimRepository.claimDue("TEST", now, limit, leaseSeconds);
  const ours = await prisma.subscription.findMany({
    where: { id: { in: claimed.map((c) => c.id) }, userId: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ourIds = new Set(ours.map((o) => o.id));
  // Give back anything that is not ours, untouched.
  await SyncClaimRepository.releaseLease(claimed.filter((c) => !ourIds.has(c.id)).map((c) => c.id), now);

  return claimed.filter((c) => ourIds.has(c.id));
}

afterEach(() => cleanupBillingUsers(PREFIX));
afterAll(async () => {
  await cleanupBillingUsers(PREFIX);
  await prisma.$disconnect();
});

describe("markDue", () => {
  it("coalesces: the earliest requested time wins, and a later mark never postpones it", async () => {
    const [sub] = await subscriptions();

    expect(await SyncClaimRepository.markDue(prisma, sub.id, "HEARTBEAT", at(30), { eventDriven: false, now: NOW })).toBe(
      true,
    );
    await SyncClaimRepository.markDue(prisma, sub.id, "WEBHOOK", at(5), { eventDriven: true, now: NOW });
    await SyncClaimRepository.markDue(prisma, sub.id, "WEBHOOK", at(20), { eventDriven: true, now: at(1) });

    const row = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(row.syncDueAt).toEqual(at(5));
    expect(row.syncReason).toBe("WEBHOOK");
    expect(row.syncRequestedAt).toEqual(at(1));
  });

  it("records syncRequestedAt only for event-driven triggers", async () => {
    const [sub] = await subscriptions();

    await SyncClaimRepository.markDue(prisma, sub.id, "CHECKPOINT", at(10), { eventDriven: false, now: NOW });

    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).syncRequestedAt).toBeNull();
  });

  it("never marks a terminal or an unbound row", async () => {
    const [cancelled, provisioning] = await subscriptions([
      { phase: "CANCELLED" },
      { phase: "PROVISIONING", providerSubscriptionId: null },
    ]);

    for (const sub of [cancelled, provisioning]) {
      expect(await SyncClaimRepository.markDue(prisma, sub.id, "WEBHOOK", NOW, { eventDriven: true, now: NOW })).toBe(
        false,
      );
      expect((await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).syncDueAt).toBeNull();
    }
  });
});

describe("claimDue", () => {
  it("claims due rows oldest first, leases them, and leaves the rest", async () => {
    const [late, early, future, unbound] = await subscriptions([
      { syncDueAt: at(-1) },
      { syncDueAt: at(-10) },
      { syncDueAt: at(10) },
      { phase: "PROVISIONING", providerSubscriptionId: null, syncDueAt: null },
    ]);

    const claimed = await claimOurs(NOW);

    expect(claimed.map((c) => c.id)).toEqual([early.id, late.id]);
    expect(claimed[0]).toMatchObject({ providerMode: "TEST", phase: "ACTIVE", providerSubscriptionId: early.providerSubscriptionId });
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: early.id } })).syncLeaseUntil).toEqual(at(1));
    for (const id of [future.id, unbound.id]) {
      expect((await prisma.subscription.findUniqueOrThrow({ where: { id } })).syncLeaseUntil).toBeNull();
    }
  });

  it("is exclusive: concurrent claims never share a row", async () => {
    const rows = await subscriptions(Array.from({ length: 8 }, (_, i) => ({ syncDueAt: at(-i - 1) })));
    const ours = new Set(rows.map((r) => r.id));

    const batches = await Promise.all(
      Array.from({ length: 4 }, () => SyncClaimRepository.claimDue("TEST", NOW, 3, 60)),
    );
    const claimedOurs = batches.flat().filter((c) => ours.has(c.id)).map((c) => c.id);

    expect(new Set(claimedOurs).size).toBe(claimedOurs.length);
    expect(claimedOurs.length).toBeLessThanOrEqual(8);
  });

  it("skips a leased row, and reclaims it once the lease lapses", async () => {
    const [sub] = await subscriptions([{ syncDueAt: at(-1) }]);

    expect((await claimOurs(NOW)).map((c) => c.id)).toEqual([sub.id]);
    expect(await claimOurs(at(0.5))).toEqual([]);
    expect((await claimOurs(at(2))).map((c) => c.id)).toEqual([sub.id]);
  });

  it("claims only the requested provider mode (TEST/LIVE isolation)", async () => {
    const [live] = await subscriptions([{ providerMode: "LIVE", syncDueAt: at(-1) }]);

    expect((await claimOurs(NOW)).map((c) => c.id)).not.toContain(live.id);

    const liveClaims = await SyncClaimRepository.claimDue("LIVE", NOW, 50, 60);
    expect(liveClaims.map((c) => c.id)).toContain(live.id);
  });

  it("binds times as UTC, to the millisecond: due exactly now is claimed, a millisecond later is not", async () => {
    const [exact, justAfter] = await subscriptions([{ syncDueAt: NOW }, { syncDueAt: new Date(NOW.getTime() + 1) }]);

    // A time-zone slip would move either boundary by hours, not a millisecond.
    expect((await claimOurs(NOW)).map((c) => c.id)).toEqual([exact.id]);
    expect((await claimOurs(new Date(NOW.getTime() + 1))).map((c) => c.id)).toEqual([justAfter.id]);
  });
});

describe("claimOne", () => {
  it("claims a row that is not due, in any mode, so the caller can check it", async () => {
    const [sub] = await subscriptions([{ providerMode: "LIVE", syncDueAt: null }]);

    expect(await SyncClaimRepository.claimOne(sub.id, NOW, 60)).toMatchObject({ id: sub.id, providerMode: "LIVE" });
  });

  it("skips a row leased elsewhere, and a row with no provider ID", async () => {
    const [leased, unbound] = await subscriptions([
      { syncLeaseUntil: at(1) },
      { phase: "PROVISIONING", providerSubscriptionId: null },
    ]);

    expect(await SyncClaimRepository.claimOne(leased.id, NOW, 60)).toBeNull();
    expect(await SyncClaimRepository.claimOne(unbound.id, NOW, 60)).toBeNull();
    expect(await SyncClaimRepository.claimOne(leased.id, at(2), 60)).toMatchObject({ id: leased.id });
  });
});

describe("dueBacklog and releaseLease", () => {
  it("releases a lease without moving the due time", async () => {
    const [sub] = await subscriptions([{ syncDueAt: at(-3) }]);

    await claimOurs(NOW);
    await SyncClaimRepository.releaseLease([sub.id], NOW);

    const row = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(row.syncLeaseUntil).toBeNull();
    expect(row.syncDueAt).toEqual(at(-3));
  });

  it("counts what is due, and finds the oldest", async () => {
    await subscriptions([{ syncDueAt: at(-3) }]);

    const backlog = await SyncClaimRepository.dueBacklog("TEST", NOW);

    expect(backlog.remainingDue).toBeGreaterThanOrEqual(1);
    expect(backlog.oldestDueAt!.getTime()).toBeLessThanOrEqual(at(-3).getTime());
  });
});
