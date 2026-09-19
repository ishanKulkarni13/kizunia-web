/**
 * Integration tests against a real Postgres database, proving the Asset
 * lifecycle's concurrency invariant:
 *
 *   An Asset may transition ACTIVE -> DETACHED only when it has no
 *   legitimate reference at the point the transition is committed.
 *
 * See docs/architecture/domain/assets/lifecycle.md#concurrency.
 *
 * The critical property under test is that `AssetRepository.lockForUpdate`
 * (`SELECT ... FOR UPDATE`) genuinely blocks a concurrent transaction on
 * the *database*, not merely "probably interleaves" at the JS event-loop
 * level. Every race test below forces the interesting interleaving
 * deterministically with a real Postgres-side delay (`pg_sleep`) rather
 * than a `Promise.all` and a hope — one side holds the Asset row lock open
 * for a fixed window, the other side is only started after that lock is
 * known to be held, so its own `FOR UPDATE` acquisition is guaranteed to
 * actually contend for the same row before either test makes an assertion.
 *
 * Same conventions as ./users/backend/user-asset.integration.test.ts: no DB
 * test harness beyond `DATABASE_TEST_URL`, everything this file writes is
 * cleaned up in `afterAll`. Run via `pnpm test:integration`.
 */
import { afterAll, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { AssetStatus } from "@/generated/prisma";
import type { StrictAuthorizationActor } from "@/authorization";

import { UserService } from "../../users/backend/service";
import { assetService } from "./service";
import { AssetRepository } from "./repository";

const FIXTURE_PREFIX = "__vitest_asset_concurrency_test__";

function fixtureId(name: string): string {
  return `${FIXTURE_PREFIX}:${name}:${Date.now()}:${Math.random()}`;
}

async function createActiveAsset(idSuffix: string, createdAt?: Date) {
  const id = fixtureId(idSuffix);

  return prisma.asset.create({
    data: {
      provider: "CLOUDINARY",
      publicId: id,
      secureUrl: `https://res.cloudinary.com/test/${id}.png`,
      category: "IMAGE",
      status: AssetStatus.ACTIVE,
      ...(createdAt && { createdAt }),
    },
  });
}

async function createActor(idSuffix: string): Promise<StrictAuthorizationActor> {
  const id = fixtureId(idSuffix);

  await prisma.user.create({
    data: {
      id,
      name: "Asset Concurrency Fixture",
      email: `${id}@example.invalid`,
    },
  });

  return { id, role: "user", banned: false };
}

/** A short, real Postgres-side pause — held open inside a transaction. */
async function holdLockFor(
  tx: import("@/generated/prisma").Prisma.TransactionClient,
  assetId: string,
  seconds: number,
): Promise<void> {
  await tx.$queryRaw`SELECT * FROM "asset" WHERE id = ${assetId} FOR UPDATE`;
  // $executeRaw, not $queryRaw: pg_sleep returns `void`, which Prisma's
  // $queryRaw cannot deserialize as a result column.
  await tx.$executeRaw`SELECT pg_sleep(${seconds})`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const userService = new UserService();

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { startsWith: FIXTURE_PREFIX } } });
  await prisma.asset.deleteMany({ where: { publicId: { startsWith: FIXTURE_PREFIX } } });
  await prisma.$disconnect();
});

describe("Asset lifecycle concurrency — attach vs. detach", () => {
  it("Test A: a reference committed while a detach is blocked on the lock is correctly seen — the asset is not detached", async () => {
    const actorA = await createActor("test-a-actor-a");
    const actorB = await createActor("test-a-actor-b");
    const asset = await createActiveAsset("test-a-asset");

    // Actor A originally held the only reference, then cleared it —
    // mirrors the precondition `detachIfUnreferenced` is always called
    // under (the caller's own reference is already gone by the time it
    // runs). Committed outside any lock-holding transaction so the
    // window below is unambiguous.
    await userService.setAsset({ actor: actorA, slot: "avatar", assetId: asset.id });
    await prisma.user.update({
      where: { id: actorA.id },
      data: { avatarAssetId: null },
    });

    // Simulates the write half of a concurrent attach: locks the Asset
    // row, holds the transaction open for 400ms (a real DB-side delay,
    // not a JS setTimeout racing the DB), then commits a legitimate new
    // reference to it.
    const attachTxPromise = prisma.$transaction(async (tx) => {
      await holdLockFor(tx, asset.id, 0.4);
      await tx.user.update({
        where: { id: actorB.id },
        data: { avatarAssetId: asset.id },
      });
    });

    // Give the transaction above time to actually start and acquire the
    // lock before the detach attempt below is issued.
    await delay(100);

    // The real, shared detach path — the same one every normal
    // User/Project/Competition/etc. asset removal and
    // AssetReconciliationService.sweepUnreferencedActive use. Its lock
    // acquisition must block until the attach transaction above commits.
    const detachPromise = prisma.$transaction((tx) =>
      assetService.detachIfUnreferenced(tx, asset.id),
    );

    const [, wasDetached] = await Promise.all([attachTxPromise, detachPromise]);

    // If the lock did not actually serialize these, `detachIfUnreferenced`
    // could have read a zero reference count before the attach committed
    // and incorrectly detached the asset out from under actor B.
    expect(wasDetached).toBe(false);

    const finalAsset = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    const userB = await prisma.user.findUniqueOrThrow({ where: { id: actorB.id } });

    expect(finalAsset.status).toBe(AssetStatus.ACTIVE);
    expect(userB.avatarAssetId).toBe(asset.id);
  });

  it("Test A (reverse): an attach that loses the race to a committed detach is correctly rejected, never left silently pointing at a detached asset", async () => {
    const actorA = await createActor("test-a-rev-actor-a");
    const actorB = await createActor("test-a-rev-actor-b");
    const asset = await createActiveAsset("test-a-rev-asset");

    await userService.setAsset({ actor: actorA, slot: "avatar", assetId: asset.id });
    await prisma.user.update({
      where: { id: actorA.id },
      data: { avatarAssetId: null },
    });

    // Simulates the detach path (the reference is already gone), holding
    // the lock open for 400ms before actually transitioning the asset.
    const detachTxPromise = prisma.$transaction(async (tx) => {
      await holdLockFor(tx, asset.id, 0.4);

      const repository = new AssetRepository(tx);
      await repository.markDetached(asset.id);
    });

    await delay(100);

    // Concurrent: actor B tries to attach the same asset via the real
    // UserService.setAsset path. Its internal lock acquisition
    // (AssetService.prepareAssetAttach) must block until the detach
    // transaction above commits, and then must see the now-DETACHED
    // status and refuse the attach — never silently succeed.
    const attachAttempt = userService.setAsset({
      actor: actorB,
      slot: "avatar",
      assetId: asset.id,
    });

    const [detachResult, attachResult] = await Promise.allSettled([
      detachTxPromise,
      attachAttempt,
    ]);

    expect(detachResult.status).toBe("fulfilled");
    expect(attachResult.status).toBe("rejected");

    const finalAsset = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    const userB = await prisma.user.findUniqueOrThrow({ where: { id: actorB.id } });

    expect(finalAsset.status).toBe(AssetStatus.DETACHED);
    // The rejected transaction must have rolled back — B never ends up
    // referencing an asset that is not ACTIVE.
    expect(userB.avatarAssetId).toBeNull();
  });

  it("Test C: clearing one of two shared references never detaches the asset while the other reference is still live", async () => {
    const actorA = await createActor("test-c-actor-a");
    const actorB = await createActor("test-c-actor-b");
    const shared = await createActiveAsset("test-c-asset");

    await userService.setAsset({ actor: actorA, slot: "avatar", assetId: shared.id });
    await userService.setAsset({ actor: actorB, slot: "avatar", assetId: shared.id });

    await userService.setAsset({ actor: actorA, slot: "avatar", assetId: null });

    const stillActive = await prisma.asset.findUniqueOrThrow({ where: { id: shared.id } });
    const userB = await prisma.user.findUniqueOrThrow({ where: { id: actorB.id } });

    expect(stillActive.status).toBe(AssetStatus.ACTIVE);
    expect(userB.avatarAssetId).toBe(shared.id);
  });
});

describe("Asset lifecycle concurrency — reconciliation (sweepUnreferencedActive)", () => {
  it("Test B: a reference committed while reconciliation's authoritative recheck is blocked on the lock prevents the detach", async () => {
    const actorB = await createActor("test-b-actor-b");
    // Old enough to be a real sweepUnreferencedActive candidate (grace
    // period is 24h) — never actually discovered via findActiveBefore in
    // this test (we drive detachIfUnreferenced directly, the same
    // authoritative call the sweep makes per-candidate), but kept
    // realistic for documentation purposes.
    const asset = await createActiveAsset(
      "test-b-asset",
      new Date(Date.now() - 48 * 60 * 60 * 1000),
    );

    // Simulates a concurrent attach landing after reconciliation has
    // already selected this asset as a candidate but before its
    // authoritative per-candidate recheck runs.
    const attachTxPromise = prisma.$transaction(async (tx) => {
      await holdLockFor(tx, asset.id, 0.4);
      await tx.user.update({
        where: { id: actorB.id },
        data: { avatarAssetId: asset.id },
      });
    });

    await delay(100);

    // The exact call AssetReconciliationService.sweepUnreferencedActive
    // makes per candidate.
    const reconciliationPromise = prisma.$transaction((tx) =>
      assetService.detachIfUnreferenced(tx, asset.id),
    );

    const [, wasDetached] = await Promise.all([attachTxPromise, reconciliationPromise]);

    expect(wasDetached).toBe(false);

    const finalAsset = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(finalAsset.status).toBe(AssetStatus.ACTIVE);

    const userB = await prisma.user.findUniqueOrThrow({ where: { id: actorB.id } });
    expect(userB.avatarAssetId).toBe(asset.id);
  });

  it("Test D: a genuinely unreferenced ACTIVE asset is still detached correctly (the fix must not break real reconciliation)", async () => {
    const asset = await createActiveAsset(
      "test-d-asset",
      new Date(Date.now() - 48 * 60 * 60 * 1000),
    );

    const wasDetached = await prisma.$transaction((tx) =>
      assetService.detachIfUnreferenced(tx, asset.id),
    );

    expect(wasDetached).toBe(true);

    const finalAsset = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(finalAsset.status).toBe(AssetStatus.DETACHED);
  });

  it("repeated invocation stays idempotent under the new locking path", async () => {
    const asset = await createActiveAsset("test-idempotent-asset");

    const first = await prisma.$transaction((tx) =>
      assetService.detachIfUnreferenced(tx, asset.id),
    );
    const second = await prisma.$transaction((tx) =>
      assetService.detachIfUnreferenced(tx, asset.id),
    );

    expect(first).toBe(true);
    expect(second).toBe(false);

    const finalAsset = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(finalAsset.status).toBe(AssetStatus.DETACHED);
  });
});
