/**
 * One rule for a soft-deleted Technology, across every consumer
 * (docs/architecture/domain/technology.md):
 *
 * - PUBLIC / display reads behave as if it does not exist;
 * - the EDITOR's own relationship list keeps it, flagged `unavailable`, so
 *   the owner can still see it and remove it;
 * - ADMIN reads keep it;
 * - no relationship row is ever deleted, and restoring the Technology makes
 *   it appear again.
 *
 * Covers Portfolio, Projects and Competitions. Requires a reachable test
 * database — see docs/testing/database.md.
 */
import { afterAll, describe, expect, it } from "vitest";

import type { StrictAuthorizationActor } from "@/authorization";
import { PlatformRole } from "@/authorization/platform/roles";
import {
  PortfolioVisibility,
  ProjectStatus,
  ProjectVisibility,
} from "@/generated/prisma";
import prisma from "@/lib/prisma";
import { CompetitionRepository } from "@/modules/competitions/backend/repository";
import { CompetitionService } from "@/modules/competitions/backend/service";
import { PortfolioMapper } from "@/modules/portfolio/backend/mapper/mapper";
import { portfolioService } from "@/modules/portfolio/backend/service";
import { portfolioTechnologyService } from "@/modules/portfolio/backend/portfolio-technology.service";
import { ProjectMapper } from "@/modules/projects/backend/mapper/project.mapper";
import { ProjectRepository } from "@/modules/projects/backend/repository";
import { ProjectTechnologyRepository } from "@/modules/projects/backend/project-technology.repository";
import { CANDIDATE_INCLUDE } from "@/modules/recommendations/backend/candidate.repository";

const TEST_PREFIX = "__vitest_deleted_technology__";

let counter = 0;

function unique(name: string): string {
  counter += 1;

  return `${TEST_PREFIX}_${name}_${Date.now()}_${counter}`;
}

function actorFor(userId: string): StrictAuthorizationActor {
  return { id: userId, role: PlatformRole.USER, banned: false };
}

async function createTechnology(name: string) {
  const key = unique(name);

  return prisma.technology.create({
    data: { name: key, slug: key.toLowerCase(), type: "OTHER" },
  });
}

async function softDelete(technologyId: string) {
  await prisma.technology.update({
    where: { id: technologyId },
    data: { deletedAt: new Date() },
  });
}

async function restore(technologyId: string) {
  await prisma.technology.update({
    where: { id: technologyId },
    data: { deletedAt: null },
  });
}

afterAll(async () => {
  await prisma.portfolioTechnology.deleteMany({
    where: { technology: { name: { startsWith: TEST_PREFIX } } },
  });
  await prisma.projectTechnology.deleteMany({
    where: { technology: { name: { startsWith: TEST_PREFIX } } },
  });
  await prisma.competitionTechnology.deleteMany({
    where: { technology: { name: { startsWith: TEST_PREFIX } } },
  });
  await prisma.portfolioProject.deleteMany({
    where: { portfolio: { user: { email: { startsWith: TEST_PREFIX } } } },
  });
  await prisma.projectMember.deleteMany({
    where: { project: { title: { startsWith: TEST_PREFIX } } },
  });
  await prisma.project.deleteMany({
    where: { title: { startsWith: TEST_PREFIX } },
  });
  await prisma.competition.deleteMany({
    where: { title: { startsWith: TEST_PREFIX } },
  });
  await prisma.portfolio.deleteMany({
    where: { user: { email: { startsWith: TEST_PREFIX } } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.technology.deleteMany({
    where: { name: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

describe("Portfolio", () => {
  async function publicPortfolio(name: string) {
    const key = unique(name);

    const user = await prisma.user.create({
      data: {
        id: key,
        name: "Deleted Technology Test User",
        email: `${key}@example.test`,
        emailVerified: true,
        username: key.toLowerCase(),
      },
    });

    const actor = actorFor(user.id);

    await portfolioService.create({ actor });
    await portfolioService.changeVisibility({
      actor,
      dto: { visibility: PortfolioVisibility.PUBLIC },
    });

    return { user, actor };
  }

  it("hides a deleted technology publicly, keeps it (flagged) in the editor, and it stays removable", async () => {
    const { user, actor } = await publicPortfolio("portfolio");

    const alive = await createTechnology("alive");
    const retired = await createTechnology("retired");

    await portfolioTechnologyService.add({
      actor,
      dto: { technologyId: alive.id },
    });
    await portfolioTechnologyService.add({
      actor,
      dto: { technologyId: retired.id },
    });

    await softDelete(retired.id);

    // Public: as if it does not exist.
    const publicDto = await portfolioService.findPublicByUsername({
      username: user.username!,
    });
    expect(publicDto.technologies.map((t) => t.technology.id)).toEqual([
      alive.id,
    ]);

    // Editor: still listed, and flagged so the UI can say why.
    const editorList = await portfolioTechnologyService.list({ actor });
    expect(
      editorList.map((t) => [t.technologyId, t.unavailable]),
    ).toEqual([
      [alive.id, false],
      [retired.id, true],
    ]);

    // The relationship row was never touched.
    expect(
      await prisma.portfolioTechnology.count({
        where: { technologyId: retired.id },
      }),
    ).toBe(1);

    // Reorder still covers the deleted entry (exact cover includes it).
    const reordered = await portfolioTechnologyService.reorder({
      actor,
      dto: { technologyIds: [retired.id, alive.id] },
    });
    expect(reordered.map((t) => t.technologyId)).toEqual([
      retired.id,
      alive.id,
    ]);

    // Removal is unconditional, so a stale reference can always be cleared.
    const afterRemove = await portfolioTechnologyService.remove({
      actor,
      technologyId: retired.id,
    });
    expect(afterRemove.map((t) => t.technologyId)).toEqual([alive.id]);
  });

  it("shows the technology again once it is restored", async () => {
    const { user, actor } = await publicPortfolio("portfolio-restore");

    const tech = await createTechnology("restorable");
    await portfolioTechnologyService.add({
      actor,
      dto: { technologyId: tech.id },
    });

    await softDelete(tech.id);
    expect(
      (
        await portfolioService.findPublicByUsername({
          username: user.username!,
        })
      ).technologies,
    ).toEqual([]);

    await restore(tech.id);
    expect(
      (
        await portfolioService.findPublicByUsername({
          username: user.username!,
        })
      ).technologies.map((t) => t.technology.id),
    ).toEqual([tech.id]);
  });

  it("does not let a deleted technology be attached", async () => {
    const { actor } = await publicPortfolio("portfolio-attach");

    const retired = await createTechnology("attach-retired");
    await softDelete(retired.id);

    await expect(
      portfolioTechnologyService.add({
        actor,
        dto: { technologyId: retired.id },
      }),
    ).rejects.toThrow();
  });

  it("marks availability on the editor mapping only", async () => {
    const tech = await createTechnology("mapper");
    await softDelete(tech.id);

    const row = await prisma.technology.findUniqueOrThrow({
      where: { id: tech.id },
      include: { iconAsset: true },
    });

    const dto = PortfolioMapper.toTechnologySummaryDto({
      portfolioId: "p",
      technologyId: tech.id,
      startedUsingAt: null,
      description: null,
      displayOrder: 0,
      technology: row,
    });

    expect(dto.unavailable).toBe(true);
  });
});

describe("Projects", () => {
  async function projectWithTechnologies(name: string) {
    const key = unique(name);

    const project = await prisma.project.create({
      data: {
        title: key,
        slug: key.toLowerCase(),
        shortDescription: "Fixture project.",
        status: ProjectStatus.PUBLISHED,
        visibility: ProjectVisibility.PUBLIC,
      },
    });

    const alive = await createTechnology(`${name}-alive`);
    const retired = await createTechnology(`${name}-retired`);

    await prisma.projectTechnology.createMany({
      data: [
        { projectId: project.id, technologyId: alive.id, displayOrder: 0 },
        { projectId: project.id, technologyId: retired.id, displayOrder: 1 },
      ],
    });

    await softDelete(retired.id);

    return { project, alive, retired };
  }

  it("omits a deleted technology from the display read", async () => {
    const { project, alive } = await projectWithTechnologies("project-display");

    const details = await new ProjectRepository().findBySlug({
      slug: project.slug,
    });

    expect(details?.technologies.map((t) => t.technologyId)).toEqual([
      alive.id,
    ]);
  });

  it("keeps it, flagged, in the editor's own technology list", async () => {
    const { project, alive, retired } =
      await projectWithTechnologies("project-editor");

    const entries = await new ProjectTechnologyRepository().findManyByProject({
      projectId: project.id,
    });
    const dtos = entries.map((entry) => ProjectMapper.toTechnologyDto(entry));

    expect(dtos.map((t) => [t.id, t.unavailable])).toEqual([
      [alive.id, false],
      [retired.id, true],
    ]);
  });
});

describe("Competitions", () => {
  async function competitionWithTechnologies(name: string) {
    const key = unique(name);

    const competition = await prisma.competition.create({
      data: { title: key, slug: key.toLowerCase() },
    });

    const alive = await createTechnology(`${name}-alive`);
    const retired = await createTechnology(`${name}-retired`);

    await prisma.competitionTechnology.createMany({
      data: [
        { competitionId: competition.id, technologyId: alive.id },
        { competitionId: competition.id, technologyId: retired.id },
      ],
    });

    await softDelete(retired.id);

    return { competition, alive, retired };
  }

  it("omits a deleted technology from the public read", async () => {
    const { competition, alive } =
      await competitionWithTechnologies("competition-public");

    const found = await CompetitionRepository.findBySlug(competition.slug);

    expect(found?.technologies.map((t) => t.technologyId)).toEqual([alive.id]);
  });

  it("keeps it on the admin edit read", async () => {
    const { competition, alive, retired } =
      await competitionWithTechnologies("competition-admin");

    const found = await CompetitionRepository.findByIdForEdit(competition.id);

    expect(found?.technologies.map((t) => t.technologyId).sort()).toEqual(
      [alive.id, retired.id].sort(),
    );
  });

  it("does not count a deleted technology as one of the competition's for recommendations", async () => {
    const { competition, alive } =
      await competitionWithTechnologies("competition-reco");

    const row = await prisma.competition.findUniqueOrThrow({
      where: { id: competition.id },
      include: CANDIDATE_INCLUDE,
    });

    expect(row.technologies.map((t) => t.technology.slug)).toEqual([
      (await prisma.technology.findUniqueOrThrow({ where: { id: alive.id } }))
        .slug,
    ]);
  });

  it("does not match a deleted technology in the public search filter", async () => {
    const { competition, alive, retired } =
      await competitionWithTechnologies("competition-search");

    // Public search only lists PUBLIC competitions.
    await prisma.competition.update({
      where: { id: competition.id },
      data: { visibility: "PUBLIC" },
    });

    const slugOf = async (id: string) =>
      (await prisma.technology.findUniqueOrThrow({ where: { id } })).slug;

    const found = async (technologySlug: string) => {
      const result = await CompetitionService.search({
        technologies: technologySlug,
        search: competition.title,
        limit: "50",
      });

      return result.items.some((item) => item.slug === competition.slug);
    };

    expect(await found(await slugOf(alive.id))).toBe(true);
    expect(await found(await slugOf(retired.id))).toBe(false);
  });
});
