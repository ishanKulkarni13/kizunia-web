/**
 * The Portfolio editor contract against a real database:
 *
 * - the editor aggregate is the explicit, slim DTO — it does not carry the
 *   sections that have their own endpoints, so a project can never reach the
 *   editor through it, and the dedicated projects list keeps enforcing the
 *   membership invariant;
 * - the resume is a DOCUMENT asset viewed through the Asset view-URL builder
 *   (never the stored, undeliverable `secureUrl`), and no signed URL is ever
 *   persisted;
 * - the resume lifecycle (attach → replace → clear) follows the Asset
 *   discipline, driven by a profile update that no longer reads the whole
 *   aggregate.
 *
 * Requires a reachable test database — see docs/testing/database.md.
 */
import { afterAll, describe, expect, it } from "vitest";

import type { StrictAuthorizationActor } from "@/authorization";
import { PlatformRole } from "@/authorization/platform/roles";
import {
  AssetStatus,
  PortfolioVisibility,
  ProjectRole,
  ProjectStatus,
  ProjectVisibility,
} from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { deleteGrantsForEmailPrefix, grantPlanWithFixtureGranter } from "@/testing/entitlement-fixtures";
import { portfolioProjectService } from "./portfolio-project.service";
import { portfolioService } from "./service";

const TEST_PREFIX = "__vitest_portfolio_editor__";

let counter = 0;

function unique(name: string): string {
  counter += 1;

  return `${TEST_PREFIX}_${name}_${Date.now()}_${counter}`;
}

async function createUser(name: string) {
  const key = unique(name);

  const user = await prisma.user.create({
    data: {
      id: key,
      name: "Editor Test User",
      email: `${key}@example.test`,
      emailVerified: true,
      username: key.toLowerCase(),
    },
  });

  // The editor is the subject here, not entitlements: the user may create
  // and publish a portfolio, through a real grant.
  await grantPlanWithFixtureGranter(user.id, "PRO", TEST_PREFIX);

  return user;
}

function actorFor(userId: string): StrictAuthorizationActor {
  return { id: userId, role: PlatformRole.USER, banned: false };
}

async function createDocumentAsset(name: string) {
  const key = unique(name);

  return prisma.asset.create({
    data: {
      provider: "CLOUDINARY",
      publicId: key,
      secureUrl: `https://res.cloudinary.com/test/raw/upload/${key}.pdf`,
      category: "DOCUMENT",
      status: AssetStatus.ACTIVE,
      mimeType: "application/pdf",
      format: "pdf",
    },
  });
}

async function createProject(name: string, ownerId: string) {
  const key = unique(name);

  const project = await prisma.project.create({
    data: {
      title: key,
      slug: key,
      shortDescription: "Fixture project.",
      status: ProjectStatus.PUBLISHED,
      visibility: ProjectVisibility.PUBLIC,
    },
  });

  await prisma.projectMember.create({
    data: { projectId: project.id, userId: ownerId, role: ProjectRole.OWNER },
  });

  return project;
}

afterAll(async () => {
  await prisma.portfolioProject.deleteMany({
    where: { portfolio: { user: { email: { startsWith: TEST_PREFIX } } } },
  });
  await prisma.projectMember.deleteMany({
    where: { project: { title: { startsWith: TEST_PREFIX } } },
  });
  await prisma.project.deleteMany({
    where: { title: { startsWith: TEST_PREFIX } },
  });
  await prisma.portfolio.deleteMany({
    where: { user: { email: { startsWith: TEST_PREFIX } } },
  });
  await deleteGrantsForEmailPrefix(TEST_PREFIX);
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.asset.deleteMany({
    where: { publicId: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

describe("editor aggregate", () => {
  it("never carries projects, even when the portfolio has some", async () => {
    const user = await createUser("aggregate");
    const actor = actorFor(user.id);
    await portfolioService.create({ actor });

    const project = await createProject("aggregate-project", user.id);
    await portfolioProjectService.add({
      actor,
      dto: { projectId: project.id },
    });

    const dto = await portfolioService.findMine({ actor });

    expect(dto).not.toBeNull();
    expect(dto).not.toHaveProperty("projects");
    expect(JSON.stringify(dto)).not.toContain(project.title);
    expect(JSON.stringify(dto)).not.toContain(project.id);
  });

  it("does not expose internal fields", async () => {
    const user = await createUser("internal");
    const actor = actorFor(user.id);
    await portfolioService.create({ actor });

    const dto = await portfolioService.findMine({ actor });
    const serialized = JSON.stringify(dto);

    expect(serialized).not.toContain("userId");
    expect(serialized).not.toContain("deletedAt");
    expect(serialized).not.toContain(user.email);
  });

  it("leaves a project whose owner is no longer a member out of the projects list", async () => {
    const user = await createUser("membership");
    const actor = actorFor(user.id);
    await portfolioService.create({ actor });

    const kept = await createProject("membership-kept", user.id);
    const left = await createProject("membership-left", user.id);

    await portfolioProjectService.add({ actor, dto: { projectId: kept.id } });
    await portfolioProjectService.add({ actor, dto: { projectId: left.id } });

    expect(
      (await portfolioProjectService.list({ actor })).map((p) => p.projectId),
    ).toEqual([kept.id, left.id]);

    // The owner leaves one project. The relationship row survives — the rule
    // is enforced at query time, not by cleanup.
    await prisma.projectMember.deleteMany({
      where: { projectId: left.id, userId: user.id },
    });

    expect(
      (await portfolioProjectService.list({ actor })).map((p) => p.projectId),
    ).toEqual([kept.id]);

    expect(
      await prisma.portfolioProject.count({ where: { projectId: left.id } }),
    ).toBe(1);

    // And the aggregate still says nothing about it.
    expect(
      JSON.stringify(await portfolioService.findMine({ actor })),
    ).not.toContain(left.title);
  });
});

describe("resume", () => {
  it("is viewed through the Asset view-URL builder, not the stored secureUrl", async () => {
    const user = await createUser("resume-url");
    const actor = actorFor(user.id);
    await portfolioService.create({ actor });

    const resume = await createDocumentAsset("resume-url-asset");

    const dto = await portfolioService.updateProfile({
      actor,
      dto: { resumeAssetId: resume.id },
    });

    expect(dto.resumeAsset?.id).toBe(resume.id);
    expect(dto.resumeAsset?.url).toBeTruthy();
    // Raw delivery is blocked at the provider for DOCUMENT assets, so the
    // stored URL must never be what a client is handed.
    expect(dto.resumeAsset?.url).not.toBe(resume.secureUrl);
    expect(JSON.stringify(dto)).not.toContain("publicId");
  });

  it("is also viewable on the public portfolio, by the same rule", async () => {
    const user = await createUser("resume-public");
    const actor = actorFor(user.id);
    await portfolioService.create({ actor });
    await portfolioService.changeVisibility({
      actor,
      dto: { visibility: PortfolioVisibility.PUBLIC },
    });

    const resume = await createDocumentAsset("resume-public-asset");
    await portfolioService.updateProfile({
      actor,
      dto: { resumeAssetId: resume.id },
    });

    const publicDto = await portfolioService.findPublicByUsername({
      username: user.username!,
    });

    expect(publicDto.resumeAsset?.id).toBe(resume.id);
    expect(publicDto.resumeAsset?.url).toBeTruthy();
    expect(publicDto.resumeAsset?.url).not.toBe(resume.secureUrl);
  });

  it("never persists the signed URL", async () => {
    const user = await createUser("resume-persist");
    const actor = actorFor(user.id);
    await portfolioService.create({ actor });

    const resume = await createDocumentAsset("resume-persist-asset");
    const dto = await portfolioService.updateProfile({
      actor,
      dto: { resumeAssetId: resume.id },
    });

    const signedUrl = dto.resumeAsset!.url;

    const asset = await prisma.asset.findUniqueOrThrow({
      where: { id: resume.id },
    });
    const portfolio = await prisma.portfolio.findUniqueOrThrow({
      where: { userId: user.id },
    });

    // The Asset row keeps exactly what it was uploaded with, and the
    // portfolio stores only the reference.
    expect(asset.secureUrl).toBe(resume.secureUrl);
    expect(JSON.stringify(asset)).not.toContain(signedUrl);
    expect(JSON.stringify(portfolio)).not.toContain(signedUrl);
    expect(portfolio.resumeAssetId).toBe(resume.id);
  });

  it("follows the Asset lifecycle: attach, replace, clear", async () => {
    const user = await createUser("resume-lifecycle");
    const actor = actorFor(user.id);
    await portfolioService.create({ actor });

    const first = await createDocumentAsset("resume-first");
    const second = await createDocumentAsset("resume-second");

    const status = async (id: string) =>
      (await prisma.asset.findUniqueOrThrow({ where: { id } })).status;

    // Attach.
    await portfolioService.updateProfile({
      actor,
      dto: { resumeAssetId: first.id },
    });
    expect(await status(first.id)).toBe(AssetStatus.ACTIVE);

    // Replace: the previous asset is detached once nothing references it.
    const replaced = await portfolioService.updateProfile({
      actor,
      dto: { resumeAssetId: second.id },
    });
    expect(replaced.resumeAsset?.id).toBe(second.id);
    expect(await status(first.id)).toBe(AssetStatus.DETACHED);
    expect(await status(second.id)).toBe(AssetStatus.ACTIVE);

    // Resubmitting the current resume is a safe no-op.
    await portfolioService.updateProfile({
      actor,
      dto: { resumeAssetId: second.id, headline: "Still here" },
    });
    expect(await status(second.id)).toBe(AssetStatus.ACTIVE);

    // Clear.
    const cleared = await portfolioService.updateProfile({
      actor,
      dto: { resumeAssetId: null },
    });
    expect(cleared.resumeAsset).toBeNull();
    expect(await status(second.id)).toBe(AssetStatus.DETACHED);

    const row = await prisma.portfolio.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(row.resumeAssetId).toBeNull();
  });

  it("leaves the resume alone when the update does not mention it", async () => {
    const user = await createUser("resume-untouched");
    const actor = actorFor(user.id);
    await portfolioService.create({ actor });

    const resume = await createDocumentAsset("resume-untouched-asset");
    await portfolioService.updateProfile({
      actor,
      dto: { resumeAssetId: resume.id },
    });

    const dto = await portfolioService.updateProfile({
      actor,
      dto: { headline: "New headline" },
    });

    expect(dto.headline).toBe("New headline");
    expect(dto.resumeAsset?.id).toBe(resume.id);
  });

  it("rejects an asset that is not a document", async () => {
    const user = await createUser("resume-image");
    const actor = actorFor(user.id);
    await portfolioService.create({ actor });

    const image = await prisma.asset.create({
      data: {
        provider: "CLOUDINARY",
        publicId: unique("resume-image-asset"),
        secureUrl: "https://res.cloudinary.com/test/image/upload/x.png",
        category: "IMAGE",
        status: AssetStatus.ACTIVE,
      },
    });

    await expect(
      portfolioService.updateProfile({
        actor,
        dto: { resumeAssetId: image.id },
      }),
    ).rejects.toThrow();
  });
});

describe("profile update", () => {
  it("returns the updated editor DTO with only the intended fields", async () => {
    const user = await createUser("profile");
    const actor = actorFor(user.id);
    await portfolioService.create({ actor });

    const dto = await portfolioService.updateProfile({
      actor,
      dto: {
        displayName: "Ada Lovelace",
        headline: "Engineer",
        bio: null,
        publicContactEmail: "ada@example.test",
      },
    });

    expect(dto).toMatchObject({
      displayName: "Ada Lovelace",
      headline: "Engineer",
      bio: null,
      publicContactEmail: "ada@example.test",
    });
    expect(dto).not.toHaveProperty("userId");
    expect(dto).not.toHaveProperty("projects");
  });
});
