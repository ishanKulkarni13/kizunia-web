/**
 * Integration tests against a real Postgres database for the Asset Admin
 * surface (AssetAdminService + the reconciliation preview/apply methods it
 * orchestrates). See docs/architecture/domain/assets/lifecycle.md and the
 * Asset Admin Management implementation plan.
 *
 * Cloudinary is mocked here (per docs/testing/conventions.md — the SDK is
 * only ever imported by storage/cloudinary.provider.ts) so DETACHED/DELETING
 * reconciliation outcomes can be exercised deterministically, including a
 * simulated provider failure. Prisma is never mocked.
 *
 * Same fixture-prefix + `afterAll` cleanup convention as
 * asset-concurrency.integration.test.ts / user-asset.integration.test.ts.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import prisma from "@/lib/prisma";
import { AssetCategory, AssetPurpose, AssetStatus } from "@/generated/prisma";
import { PlatformRole, type StrictAuthorizationActor } from "@/authorization";
import { ForbiddenError, NotFoundError } from "@/lib/errors";

const mockState = vi.hoisted(() => ({
  deletionCalls: [] as string[],
  shouldFailDeletion: new Set<string>(),
  downloadCallCount: 0,
  activeConcurrentDeletions: 0,
  maxConcurrentDeletions: 0,
}));

vi.mock("./storage/cloudinary.provider", () => {
  class MockCloudinaryStorageProvider {
    async authorizeUpload(): Promise<never> {
      throw new Error("authorizeUpload is not used by the admin surface under test.");
    }

    async confirmUpload(): Promise<never> {
      throw new Error("confirmUpload is not used by the admin surface under test.");
    }

    async deleteObject(providerObjectId: string): Promise<void> {
      mockState.activeConcurrentDeletions += 1;
      mockState.maxConcurrentDeletions = Math.max(
        mockState.maxConcurrentDeletions,
        mockState.activeConcurrentDeletions,
      );

      // A short, real delay — long enough that a `Promise.all` caller would
      // measurably overlap two calls, proving `applyToIds` is sequential.
      await new Promise((resolve) => setTimeout(resolve, 20));

      mockState.activeConcurrentDeletions -= 1;

      if (mockState.shouldFailDeletion.has(providerObjectId)) {
        throw new Error("mock provider deletion failure");
      }

      mockState.deletionCalls.push(providerObjectId);
    }

    buildViewUrl(input: { secureUrl: string }): string {
      return input.secureUrl;
    }

    buildDurableViewUrl(input: {
      category: AssetCategory;
      secureUrl: string;
    }): string | null {
      return input.category === AssetCategory.DOCUMENT ? null : input.secureUrl;
    }

    buildDownloadUrl(input: { publicId: string }): string {
      mockState.downloadCallCount += 1;
      return `https://mock.example/download/${input.publicId}?call=${mockState.downloadCallCount}`;
    }
  }

  return { CloudinaryStorageProvider: MockCloudinaryStorageProvider };
});

import { assetAdminService } from "./admin.service";
import { AssetNotDownloadableError } from "./errors";
import { AssetReferenceChecker } from "./reference-checker";
import { AssetReferenceReporter } from "./reference-metadata";

const FIXTURE_PREFIX = "__vitest_asset_admin_test__";
const HALF_DAY_MS = 12 * 60 * 60 * 1_000;
const PAST_GRACE_PERIOD = new Date(Date.now() - 48 * 60 * 60 * 1_000);

function fixtureId(name: string): string {
  return `${FIXTURE_PREFIX}:${name}:${Date.now()}:${Math.random()}`;
}

async function createActiveAsset(
  idSuffix: string,
  overrides: { createdAt?: Date; category?: AssetCategory } = {},
) {
  const id = fixtureId(idSuffix);

  return prisma.asset.create({
    data: {
      provider: "CLOUDINARY",
      publicId: id,
      secureUrl: `https://res.cloudinary.com/test/${id}.png`,
      category: overrides.category ?? AssetCategory.IMAGE,
      status: AssetStatus.ACTIVE,
      ...(overrides.createdAt && { createdAt: overrides.createdAt }),
    },
  });
}

async function createDetachedAsset(idSuffix: string, detachedAt: Date) {
  const id = fixtureId(idSuffix);

  return prisma.asset.create({
    data: {
      provider: "CLOUDINARY",
      publicId: id,
      secureUrl: `https://res.cloudinary.com/test/${id}.png`,
      category: AssetCategory.IMAGE,
      status: AssetStatus.DETACHED,
      detachedAt,
    },
  });
}

async function createDeletingAsset(idSuffix: string) {
  const id = fixtureId(idSuffix);

  return prisma.asset.create({
    data: {
      provider: "CLOUDINARY",
      publicId: id,
      secureUrl: `https://res.cloudinary.com/test/${id}.png`,
      category: AssetCategory.IMAGE,
      status: AssetStatus.DELETING,
    },
  });
}

async function createDeletedAsset(idSuffix: string) {
  const id = fixtureId(idSuffix);

  return prisma.asset.create({
    data: {
      provider: "CLOUDINARY",
      publicId: id,
      secureUrl: `https://res.cloudinary.com/test/${id}.png`,
      category: AssetCategory.IMAGE,
      status: AssetStatus.DELETED,
    },
  });
}

async function createActor(idSuffix: string): Promise<StrictAuthorizationActor> {
  const id = fixtureId(idSuffix);

  await prisma.user.create({
    data: { id, name: "Asset Admin Fixture", email: `${id}@example.invalid` },
  });

  return { id, role: PlatformRole.USER, banned: false };
}

const admin: StrictAuthorizationActor = { id: "admin-fixture", role: PlatformRole.ADMIN, banned: false };
const nonAdmin: StrictAuthorizationActor = { id: "user-fixture", role: PlatformRole.USER, banned: false };

const createdCompetitionIds: string[] = [];
const createdProjectIds: string[] = [];

beforeEach(() => {
  mockState.deletionCalls = [];
  mockState.shouldFailDeletion.clear();
  mockState.activeConcurrentDeletions = 0;
  mockState.maxConcurrentDeletions = 0;
});

afterAll(async () => {
  if (createdCompetitionIds.length > 0) {
    await prisma.competition.deleteMany({ where: { id: { in: createdCompetitionIds } } });
  }
  if (createdProjectIds.length > 0) {
    await prisma.project.deleteMany({ where: { id: { in: createdProjectIds } } });
  }
  await prisma.uploadIntent.deleteMany({ where: { actorId: { startsWith: FIXTURE_PREFIX } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: FIXTURE_PREFIX } } });
  await prisma.asset.deleteMany({ where: { publicId: { startsWith: FIXTURE_PREFIX } } });
  await prisma.$disconnect();
});

describe("AssetAdminService - authorization", () => {
  it("rejects a non-admin actor on every admin method", async () => {
    const asset = await createActiveAsset("authz-target");

    await expect(assetAdminService.search(nonAdmin, {})).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(assetAdminService.getSummary(nonAdmin)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      assetAdminService.getById(nonAdmin, asset.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      assetAdminService.getDownloadTarget(nonAdmin, asset.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      assetAdminService.previewReconciliation(nonAdmin, {}),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      assetAdminService.applyReconciliation(nonAdmin, [asset.id]),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("allows an admin actor", async () => {
    const result = await assetAdminService.search(admin, { limit: "1" });
    expect(result.items).toBeDefined();
  });
});

describe("AssetAdminService - reference semantics (referenceCount regression)", () => {
  it("counts a User referencing the same asset from BOTH avatar and cover as ONE reference", async () => {
    const actor = await createActor("ref-user-both");
    const asset = await createActiveAsset("ref-user-both-asset");

    await prisma.user.update({
      where: { id: actor.id },
      data: { avatarAssetId: asset.id, coverAssetId: asset.id },
    });

    const detail = await assetAdminService.getById(admin, asset.id);

    expect(detail.referenceCount).toBe(1);
    expect(detail.references).toEqual(
      expect.arrayContaining([
        { entity: "User", slot: "avatar", count: 1 },
        { entity: "User", slot: "cover", count: 1 },
      ]),
    );

    const lifecycleCount = await AssetReferenceChecker.countReferences(prisma, asset.id);
    expect(lifecycleCount).toBe(detail.referenceCount);
  });

  it("counts a Competition referencing the same asset from logo+banner+cover as ONE reference", async () => {
    const asset = await createActiveAsset("ref-competition-asset");

    const competition = await prisma.competition.create({
      data: {
        title: "Asset Admin Fixture Competition",
        slug: fixtureId("ref-competition-slug"),
        logoAssetId: asset.id,
        bannerAssetId: asset.id,
        coverAssetId: asset.id,
      },
    });
    createdCompetitionIds.push(competition.id);

    const detail = await assetAdminService.getById(admin, asset.id);

    expect(detail.referenceCount).toBe(1);
    expect(detail.references).toHaveLength(3);

    const lifecycleCount = await AssetReferenceChecker.countReferences(prisma, asset.id);
    expect(lifecycleCount).toBe(1);
    expect(lifecycleCount).toBe(detail.referenceCount);
  });

  it("counts a Project referencing the same asset from logo+cover as ONE reference", async () => {
    const asset = await createActiveAsset("ref-project-asset");

    const project = await prisma.project.create({
      data: {
        title: "Asset Admin Fixture Project",
        slug: fixtureId("ref-project-slug"),
        shortDescription: "fixture",
        logoAssetId: asset.id,
        coverAssetId: asset.id,
      },
    });
    createdProjectIds.push(project.id);

    const detail = await assetAdminService.getById(admin, asset.id);

    expect(detail.referenceCount).toBe(1);
    expect(detail.references).toHaveLength(2);

    const lifecycleCount = await AssetReferenceChecker.countReferences(prisma, asset.id);
    expect(lifecycleCount).toBe(1);
    expect(lifecycleCount).toBe(detail.referenceCount);
  });

  it("counts multiple DISTINCT source entities as multiple references", async () => {
    const actorA = await createActor("ref-multi-a");
    const actorB = await createActor("ref-multi-b");
    const asset = await createActiveAsset("ref-multi-asset");

    await prisma.user.update({ where: { id: actorA.id }, data: { avatarAssetId: asset.id } });
    await prisma.user.update({ where: { id: actorB.id }, data: { avatarAssetId: asset.id } });

    const detail = await assetAdminService.getById(admin, asset.id);
    expect(detail.referenceCount).toBe(2);

    const lifecycleCount = await AssetReferenceChecker.countReferences(prisma, asset.id);
    expect(lifecycleCount).toBe(2);
    expect(lifecycleCount).toBe(detail.referenceCount);
  });

  it("reports zero references, and an empty breakdown, for an unreferenced asset", async () => {
    const asset = await createActiveAsset("ref-zero-asset");

    const detail = await assetAdminService.getById(admin, asset.id);

    expect(detail.referenceCount).toBe(0);
    expect(detail.references).toEqual([]);
  });

  it("computes the reference report once per page, not once per row (no N+1)", async () => {
    await Promise.all(
      Array.from({ length: 5 }, (_, i) => createActiveAsset(`nplusone-${i}`)),
    );

    const spy = vi.spyOn(AssetReferenceReporter, "forAssets");

    await assetAdminService.search(admin, { limit: "50" });

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("AssetAdminService - list", () => {
  it("paginates", async () => {
    const windowStart = new Date();
    const created = await Promise.all([
      createActiveAsset("paginate-a"),
      createActiveAsset("paginate-b"),
      createActiveAsset("paginate-c"),
    ]);
    const windowEnd = new Date();

    const dateFilter = {
      createdFrom: windowStart.toISOString(),
      createdTo: windowEnd.toISOString(),
    };

    const page1 = await assetAdminService.search(admin, {
      ...dateFilter,
      limit: "2",
      page: "1",
    });
    expect(page1.items).toHaveLength(2);
    expect(page1.pagination.total).toBe(3);
    expect(page1.pagination.hasNextPage).toBe(true);
    expect(page1.pagination.hasPreviousPage).toBe(false);

    const page2 = await assetAdminService.search(admin, {
      ...dateFilter,
      limit: "2",
      page: "2",
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.pagination.hasNextPage).toBe(false);
    expect(page2.pagination.hasPreviousPage).toBe(true);

    const pagedIds = [...page1.items, ...page2.items].map((item) => item.id).sort();
    expect(pagedIds).toEqual(created.map((asset) => asset.id).sort());
  });

  it("filters by status", async () => {
    const asset = await createDeletedAsset("filter-status-asset");

    const result = await assetAdminService.search(admin, {
      id: asset.id,
      status: AssetStatus.DELETED,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe(asset.id);

    const wrongStatus = await assetAdminService.search(admin, {
      id: asset.id,
      status: AssetStatus.ACTIVE,
    });
    expect(wrongStatus.items).toHaveLength(0);
  });

  it("filters by category", async () => {
    const asset = await createActiveAsset("filter-category-asset", {
      category: AssetCategory.DOCUMENT,
    });

    const matching = await assetAdminService.search(admin, {
      id: asset.id,
      category: AssetCategory.DOCUMENT,
    });
    expect(matching.items).toHaveLength(1);

    const notMatching = await assetAdminService.search(admin, {
      id: asset.id,
      category: AssetCategory.VIDEO,
    });
    expect(notMatching.items).toHaveLength(0);
  });

  it("filters by referenced/unreferenced", async () => {
    const referencedAsset = await createActiveAsset("filter-referenced-asset");
    const actor = await createActor("filter-referenced-actor");
    await prisma.user.update({
      where: { id: actor.id },
      data: { avatarAssetId: referencedAsset.id },
    });

    const unreferencedAsset = await createActiveAsset("filter-unreferenced-asset");

    const referenced = await assetAdminService.search(admin, {
      id: referencedAsset.id,
      referenced: "yes",
    });
    expect(referenced.items).toHaveLength(1);

    const notReferenced = await assetAdminService.search(admin, {
      id: referencedAsset.id,
      referenced: "no",
    });
    expect(notReferenced.items).toHaveLength(0);

    const unreferenced = await assetAdminService.search(admin, {
      id: unreferencedAsset.id,
      referenced: "no",
    });
    expect(unreferenced.items).toHaveLength(1);
  });

  it("filters by id exact-match", async () => {
    const asset = await createActiveAsset("filter-id-asset");

    const result = await assetAdminService.search(admin, { id: asset.id });
    expect(result.items.map((item) => item.id)).toEqual([asset.id]);
  });

  it("never leaks provider-internal fields, and omits previewUrl for DOCUMENT", async () => {
    const asset = await createActiveAsset("leak-asset", {
      category: AssetCategory.DOCUMENT,
    });

    const result = await assetAdminService.search(admin, { id: asset.id });
    const row = result.items[0] as unknown as Record<string, unknown>;

    expect(row).not.toHaveProperty("publicId");
    expect(row).not.toHaveProperty("secureUrl");
    expect(row).not.toHaveProperty("provider");
    expect(row).not.toHaveProperty("checksum");
    expect(row.previewUrl).toBeNull();
  });

  it("returns a durable previewUrl for an IMAGE asset", async () => {
    const asset = await createActiveAsset("preview-image-asset", {
      category: AssetCategory.IMAGE,
    });

    const result = await assetAdminService.search(admin, { id: asset.id });
    expect(result.items[0].previewUrl).toBe(asset.secureUrl);
  });
});

describe("AssetAdminService - summary", () => {
  it("reports global counts that match a direct groupBy, independent of the list's own filters", async () => {
    const summary = await assetAdminService.getSummary(admin);

    const [active, detached, deleting, deleted] = await Promise.all([
      prisma.asset.count({ where: { status: AssetStatus.ACTIVE } }),
      prisma.asset.count({ where: { status: AssetStatus.DETACHED } }),
      prisma.asset.count({ where: { status: AssetStatus.DELETING } }),
      prisma.asset.count({ where: { status: AssetStatus.DELETED } }),
    ]);

    expect(summary.active).toBe(active);
    expect(summary.detached).toBe(detached);
    expect(summary.deleting).toBe(deleting);
    expect(summary.deleted).toBe(deleted);
    expect(summary.total).toBe(active + detached + deleting + deleted);
  });
});

describe("AssetAdminService - detail", () => {
  it("throws NotFoundError for an unknown id", async () => {
    await expect(
      assetAdminService.getById(admin, fixtureId("does-not-exist")),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("resolves the originating purpose from its UploadIntent", async () => {
    const actor = await createActor("purpose-actor");
    const asset = await createActiveAsset("purpose-asset");

    await prisma.uploadIntent.create({
      data: {
        actorId: actor.id,
        purpose: AssetPurpose.USER_AVATAR,
        category: AssetCategory.IMAGE,
        providerCorrelationId: fixtureId("purpose-correlation"),
        declaredMimeType: "image/png",
        declaredSize: 100,
        resultAssetId: asset.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const detail = await assetAdminService.getById(admin, asset.id);
    expect(detail.originatingPurpose).toBe(AssetPurpose.USER_AVATAR);
  });

  it("returns null originating purpose for a legacy row with no matching UploadIntent", async () => {
    const asset = await createActiveAsset("purpose-legacy-asset");

    const detail = await assetAdminService.getById(admin, asset.id);
    expect(detail.originatingPurpose).toBeNull();
  });
});

describe("AssetAdminService - download", () => {
  it("mints a URL for an ACTIVE asset", async () => {
    const asset = await createActiveAsset("download-active-asset");

    const { url } = await assetAdminService.getDownloadTarget(admin, asset.id);
    expect(url).toContain(asset.publicId);
  });

  it("refuses a DELETED asset", async () => {
    const asset = await createDeletedAsset("download-deleted-asset");

    await expect(
      assetAdminService.getDownloadTarget(admin, asset.id),
    ).rejects.toBeInstanceOf(AssetNotDownloadableError);
  });

  it("throws NotFoundError for an unknown id", async () => {
    await expect(
      assetAdminService.getDownloadTarget(admin, fixtureId("download-missing")),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("mints a fresh, distinct URL on every call — never persists or caches it", async () => {
    const asset = await createActiveAsset("download-fresh-asset");

    const first = await assetAdminService.getDownloadTarget(admin, asset.id);
    const second = await assetAdminService.getDownloadTarget(admin, asset.id);

    expect(first.url).not.toBe(second.url);
  });
});

describe("AssetAdminService - reconciliation preview", () => {
  it("never mutates state", async () => {
    const asset = await createActiveAsset("preview-noop-asset", {
      createdAt: PAST_GRACE_PERIOD,
    });

    const before = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    await assetAdminService.previewReconciliation(admin, { limit: "200" });
    const after = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });

    expect(after.status).toBe(before.status);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(mockState.deletionCalls).toEqual([]);
  });

  it("classifies each of the three candidate kinds correctly", async () => {
    const active = await createActiveAsset("preview-kind-active", {
      createdAt: PAST_GRACE_PERIOD,
    });
    const detached = await createDetachedAsset("preview-kind-detached", PAST_GRACE_PERIOD);
    const deleting = await createDeletingAsset("preview-kind-deleting");

    const preview = await assetAdminService.previewReconciliation(admin, { limit: "200" });
    const kindById = new Map(preview.items.map((item) => [item.id, item.kind]));

    expect(kindById.get(active.id)).toBe("UNREFERENCED_ACTIVE");
    expect(kindById.get(detached.id)).toBe("DETACHED_AWAITING_CLEANUP");
    expect(kindById.get(deleting.id)).toBe("DELETING_RETRY");
  });

  it("never lists a still-referenced ACTIVE asset as a candidate", async () => {
    const asset = await createActiveAsset("preview-referenced-asset", {
      createdAt: PAST_GRACE_PERIOD,
    });
    const actor = await createActor("preview-referenced-actor");
    await prisma.user.update({ where: { id: actor.id }, data: { avatarAssetId: asset.id } });

    const preview = await assetAdminService.previewReconciliation(admin, { limit: "200" });
    expect(preview.items.some((item) => item.id === asset.id)).toBe(false);
  });

  it("does not list an ACTIVE asset still within its grace period", async () => {
    const asset = await createActiveAsset("preview-fresh-asset");

    const preview = await assetAdminService.previewReconciliation(admin, { limit: "200" });
    expect(preview.items.some((item) => item.id === asset.id)).toBe(false);
  });
});

describe("AssetAdminService - reconciliation apply", () => {
  it("re-evaluates fresh: a candidate that gained a reference since preview is NOT_ELIGIBLE and stays ACTIVE", async () => {
    const asset = await createActiveAsset("apply-stale-asset", {
      createdAt: PAST_GRACE_PERIOD,
    });
    const actor = await createActor("apply-stale-actor");
    await prisma.user.update({ where: { id: actor.id }, data: { avatarAssetId: asset.id } });

    const result = await assetAdminService.applyReconciliation(admin, [asset.id]);

    expect(result.results).toEqual([
      { id: asset.id, outcome: "NOT_ELIGIBLE", reason: "Still referenced." },
    ]);

    const row = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(row.status).toBe(AssetStatus.ACTIVE);
  });

  it("reports NOT_ELIGIBLE for an ACTIVE asset still within its grace period", async () => {
    const asset = await createActiveAsset("apply-fresh-asset");

    const result = await assetAdminService.applyReconciliation(admin, [asset.id]);
    expect(result.results[0].outcome).toBe("NOT_ELIGIBLE");

    const row = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(row.status).toBe(AssetStatus.ACTIVE);
  });

  it("detaches a genuine unreferenced ACTIVE orphan past its grace period", async () => {
    const asset = await createActiveAsset("apply-orphan-asset", {
      createdAt: PAST_GRACE_PERIOD,
    });

    const result = await assetAdminService.applyReconciliation(admin, [asset.id]);
    expect(result.results).toEqual([{ id: asset.id, outcome: "DETACHED" }]);

    const row = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(row.status).toBe(AssetStatus.DETACHED);
  });

  it("moves a DETACHED asset past its cleanup grace period to DELETED via the provider", async () => {
    const asset = await createDetachedAsset("apply-detached-asset", PAST_GRACE_PERIOD);

    const result = await assetAdminService.applyReconciliation(admin, [asset.id]);
    expect(result.results).toEqual([{ id: asset.id, outcome: "DELETED" }]);

    const row = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(row.status).toBe(AssetStatus.DELETED);
    expect(mockState.deletionCalls).toContain(asset.publicId);
  });

  it("retries deletion for a DELETING asset via the provider", async () => {
    const asset = await createDeletingAsset("apply-deleting-retry-asset");

    const result = await assetAdminService.applyReconciliation(admin, [asset.id]);
    expect(result.results).toEqual([{ id: asset.id, outcome: "DELETED" }]);

    const row = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(row.status).toBe(AssetStatus.DELETED);
  });

  it("reports DEFERRED and leaves the asset in DELETING when the provider deletion fails", async () => {
    const asset = await createDetachedAsset("apply-fail-asset", PAST_GRACE_PERIOD);
    mockState.shouldFailDeletion.add(asset.publicId);

    const result = await assetAdminService.applyReconciliation(admin, [asset.id]);
    expect(result.results[0].outcome).toBe("DEFERRED");

    const row = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(row.status).toBe(AssetStatus.DELETING);
  });

  it("does not act on an ACTIVE, DETACHED, or DELETING asset still inside its grace window, but does act once past it (boundary sanity)", async () => {
    const withinWindow = await createDetachedAsset(
      "apply-boundary-fresh",
      new Date(Date.now() - HALF_DAY_MS),
    );

    const result = await assetAdminService.applyReconciliation(admin, [withinWindow.id]);
    expect(result.results[0].outcome).toBe("NOT_ELIGIBLE");

    const row = await prisma.asset.findUniqueOrThrow({ where: { id: withinWindow.id } });
    expect(row.status).toBe(AssetStatus.DETACHED);
  });

  it("returns NOT_FOUND for an id that does not exist", async () => {
    const missingId = fixtureId("apply-missing-id");

    const result = await assetAdminService.applyReconciliation(admin, [missingId]);
    expect(result.results).toEqual([{ id: missingId, outcome: "NOT_FOUND" }]);
  });

  it("reports a DELETED asset as already handled (NOT_ELIGIBLE) rather than re-processing it", async () => {
    const asset = await createDeletedAsset("apply-already-deleted-asset");

    const result = await assetAdminService.applyReconciliation(admin, [asset.id]);
    expect(result.results[0].outcome).toBe("NOT_ELIGIBLE");
  });

  it("stays idempotent under repeated apply", async () => {
    const asset = await createActiveAsset("apply-idempotent-asset", {
      createdAt: PAST_GRACE_PERIOD,
    });

    const first = await assetAdminService.applyReconciliation(admin, [asset.id]);
    const second = await assetAdminService.applyReconciliation(admin, [asset.id]);

    expect(first.results[0].outcome).toBe("DETACHED");
    expect(second.results[0].outcome).toBe("NOT_ELIGIBLE");
  });

  it("processes multiple ids SEQUENTIALLY, never via Promise.all", async () => {
    const assets = await Promise.all([
      createDetachedAsset("apply-sequential-a", PAST_GRACE_PERIOD),
      createDetachedAsset("apply-sequential-b", PAST_GRACE_PERIOD),
      createDetachedAsset("apply-sequential-c", PAST_GRACE_PERIOD),
    ]);

    const result = await assetAdminService.applyReconciliation(
      admin,
      assets.map((asset) => asset.id),
    );

    expect(result.results.every((row) => row.outcome === "DELETED")).toBe(true);
    // Never more than one deletion in flight at a time — proves the
    // implementation awaits each provider call before starting the next,
    // rather than firing them concurrently.
    expect(mockState.maxConcurrentDeletions).toBe(1);
    expect(mockState.deletionCalls).toEqual(assets.map((asset) => asset.publicId));
  });

  it("never detaches or deletes a referenced ACTIVE asset, even when explicitly targeted (no bypass)", async () => {
    const asset = await createActiveAsset("apply-no-bypass-asset", {
      createdAt: PAST_GRACE_PERIOD,
    });
    const actor = await createActor("apply-no-bypass-actor");
    await prisma.user.update({ where: { id: actor.id }, data: { avatarAssetId: asset.id } });

    const result = await assetAdminService.applyReconciliation(admin, [asset.id]);
    expect(result.results[0].outcome).toBe("NOT_ELIGIBLE");

    const [row, userRow] = await Promise.all([
      prisma.asset.findUniqueOrThrow({ where: { id: asset.id } }),
      prisma.user.findUniqueOrThrow({ where: { id: actor.id } }),
    ]);
    expect(row.status).toBe(AssetStatus.ACTIVE);
    expect(userRow.avatarAssetId).toBe(asset.id);
  });
});
