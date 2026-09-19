/**
 * Integration tests against a real Postgres database — same convention as
 * `src/lib/rate-limit/postgres.store.integration.test.ts`: no DB test
 * harness beyond `DATABASE_TEST_URL`, everything this file writes is
 * cleaned up in `afterAll`. Run via `pnpm test:integration`.
 */
import { afterAll, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { AssetStatus } from "@/generated/prisma";
import type { StrictAuthorizationActor } from "@/authorization";

import { AssetCategoryMismatchError, AssetNotFoundError } from "../../assets/backend/errors";
import { UserService } from "./service";

const FIXTURE_PREFIX = "__vitest_user_asset_test__";

function fixtureId(name: string): string {
  return `${FIXTURE_PREFIX}:${name}:${Date.now()}:${Math.random()}`;
}

async function createActiveAsset(idSuffix: string, category: "IMAGE" | "DOCUMENT" = "IMAGE") {
  const id = fixtureId(idSuffix);

  return prisma.asset.create({
    data: {
      provider: "CLOUDINARY",
      publicId: id,
      secureUrl: `https://res.cloudinary.com/test/${id}.png`,
      category,
      status: AssetStatus.ACTIVE,
    },
  });
}

async function createActor(idSuffix: string): Promise<StrictAuthorizationActor> {
  const id = fixtureId(idSuffix);

  await prisma.user.create({
    data: {
      id,
      name: "User Asset Fixture",
      email: `${id}@example.invalid`,
    },
  });

  return { id, role: "user", banned: false };
}

const userService = new UserService();

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { id: { startsWith: FIXTURE_PREFIX } },
  });
  await prisma.asset.deleteMany({
    where: { publicId: { startsWith: FIXTURE_PREFIX } },
  });
  await prisma.$disconnect();
});

describe("UserService.setAsset — avatar", () => {
  it("sets a new avatar and reports the resolved reference", async () => {
    const actor = await createActor("set-avatar-actor");
    const asset = await createActiveAsset("set-avatar-asset");

    const result = await userService.setAsset({
      actor,
      slot: "avatar",
      assetId: asset.id,
    });

    expect(result).toMatchObject({ slot: "avatar", assetId: asset.id });
    expect(result.url).toBeTruthy();

    const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    expect(user.avatarAssetId).toBe(asset.id);
  });

  it("replacing the avatar detaches the previous asset once nothing else references it", async () => {
    const actor = await createActor("replace-avatar-actor");
    const oldAsset = await createActiveAsset("replace-avatar-old");
    const newAsset = await createActiveAsset("replace-avatar-new");

    await userService.setAsset({ actor, slot: "avatar", assetId: oldAsset.id });
    await userService.setAsset({ actor, slot: "avatar", assetId: newAsset.id });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    expect(user.avatarAssetId).toBe(newAsset.id);

    const detachedOld = await prisma.asset.findUniqueOrThrow({ where: { id: oldAsset.id } });
    expect(detachedOld.status).toBe(AssetStatus.DETACHED);
  });

  it("removing the avatar clears the reference and detaches the asset", async () => {
    const actor = await createActor("remove-avatar-actor");
    const asset = await createActiveAsset("remove-avatar-asset");

    await userService.setAsset({ actor, slot: "avatar", assetId: asset.id });
    const result = await userService.setAsset({ actor, slot: "avatar", assetId: null });

    expect(result).toEqual({ slot: "avatar", assetId: null, url: null });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    expect(user.avatarAssetId).toBeNull();

    const detached = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(detached.status).toBe(AssetStatus.DETACHED);
  });

  it("removing an already-null avatar is a safe no-op", async () => {
    const actor = await createActor("remove-null-avatar-actor");

    const result = await userService.setAsset({ actor, slot: "avatar", assetId: null });

    expect(result).toEqual({ slot: "avatar", assetId: null, url: null });
  });

  it("resubmitting the currently-set avatar is a no-op and does not detach it", async () => {
    const actor = await createActor("resubmit-avatar-actor");
    const asset = await createActiveAsset("resubmit-avatar-asset");

    await userService.setAsset({ actor, slot: "avatar", assetId: asset.id });
    await userService.setAsset({ actor, slot: "avatar", assetId: asset.id });

    const stillActive = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(stillActive.status).toBe(AssetStatus.ACTIVE);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    expect(user.avatarAssetId).toBe(asset.id);
  });

  it("rejects an asset id that does not exist", async () => {
    const actor = await createActor("invalid-avatar-actor");

    await expect(
      userService.setAsset({ actor, slot: "avatar", assetId: fixtureId("nonexistent") }),
    ).rejects.toBeInstanceOf(AssetNotFoundError);
  });

  it("rejects an asset whose category the avatar purpose does not accept", async () => {
    const actor = await createActor("wrong-category-avatar-actor");
    const documentAsset = await createActiveAsset("wrong-category-avatar-asset", "DOCUMENT");

    await expect(
      userService.setAsset({ actor, slot: "avatar", assetId: documentAsset.id }),
    ).rejects.toBeInstanceOf(AssetCategoryMismatchError);
  });

  it("a shared asset (also referenced as another actor's avatar) is not detached while still referenced", async () => {
    const actorA = await createActor("shared-avatar-actor-a");
    const actorB = await createActor("shared-avatar-actor-b");
    const shared = await createActiveAsset("shared-avatar-asset");

    await userService.setAsset({ actor: actorA, slot: "avatar", assetId: shared.id });
    await userService.setAsset({ actor: actorB, slot: "avatar", assetId: shared.id });

    // Clearing actor A's reference must not detach an asset actor B still
    // legitimately references.
    await userService.setAsset({ actor: actorA, slot: "avatar", assetId: null });

    const stillActive = await prisma.asset.findUniqueOrThrow({ where: { id: shared.id } });
    expect(stillActive.status).toBe(AssetStatus.ACTIVE);

    const userB = await prisma.user.findUniqueOrThrow({ where: { id: actorB.id } });
    expect(userB.avatarAssetId).toBe(shared.id);
  });
});

describe("UserService.setAsset — cover", () => {
  it("sets, replaces, and removes a cover independently of the avatar slot", async () => {
    const actor = await createActor("cover-actor");
    const avatar = await createActiveAsset("cover-actor-avatar");
    const coverA = await createActiveAsset("cover-actor-cover-a");
    const coverB = await createActiveAsset("cover-actor-cover-b");

    await userService.setAsset({ actor, slot: "avatar", assetId: avatar.id });
    await userService.setAsset({ actor, slot: "cover", assetId: coverA.id });
    await userService.setAsset({ actor, slot: "cover", assetId: coverB.id });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    expect(user.avatarAssetId).toBe(avatar.id);
    expect(user.coverAssetId).toBe(coverB.id);

    const detachedCoverA = await prisma.asset.findUniqueOrThrow({ where: { id: coverA.id } });
    expect(detachedCoverA.status).toBe(AssetStatus.DETACHED);

    const removed = await userService.setAsset({ actor, slot: "cover", assetId: null });
    expect(removed.assetId).toBeNull();

    const stillHasAvatar = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    expect(stillHasAvatar.avatarAssetId).toBe(avatar.id);
    expect(stillHasAvatar.coverAssetId).toBeNull();
  });
});
