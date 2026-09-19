/**
 * Standing regression check for the Portfolio Projects editor-vs-public
 * visibility split, the membership query-time invariant (delete → hidden,
 * recreate → visible again), and DTO safety.
 *
 * Editor rule: relationship + active membership + `deletedAt: null`. No
 * project status/visibility filter — PUBLIC, PRIVATE, DRAFT and UNLISTED all
 * appear while the owner remains a member.
 *
 * Public rule: editor rule + `publiclyListableProjectWhere` (deletedAt: null,
 * visibility: PUBLIC, status: PUBLISHED) + the pre-existing `hidden: false`
 * filter.
 *
 * There is no test runner in this repository yet, so this is a standalone
 * script, following the convention in `verify-portfolio-editor-ownership.ts`
 * and `verify-portfolio-visibility.ts`. Run with:
 *
 *   pnpm exec tsx scripts/verify-portfolio-projects-visibility.ts
 */

import { randomUUID } from "node:crypto";

import {
  PortfolioVisibility,
  PrismaClient,
  ProjectRole,
  ProjectStatus,
  ProjectVisibility,
} from "../src/generated/prisma";
import { PlatformRole } from "../src/authorization/platform/roles";
import { portfolioProjectService } from "../src/modules/portfolio/backend/portfolio-project.service";
import { portfolioService } from "../src/modules/portfolio/backend/service";

const prisma = new PrismaClient();

let failures = 0;
let checks = 0;

function report(label: string, ok: boolean, detail?: string): void {
  checks += 1;

  if (ok) {
    console.log(`  ok   ${label}`);
    return;
  }

  failures += 1;
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

const FIXTURE_PREFIX = "__verify_portfolio_projects_visibility__";

async function seedOwner(suffix: string) {
  const username = `${FIXTURE_PREFIX.replace(/_/g, "")}${suffix}${randomUUID().slice(0, 8)}`;

  const user = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: `${FIXTURE_PREFIX} ${suffix}`,
      email: `${FIXTURE_PREFIX}-${suffix}@example.com`,
      username,
    },
  });

  const portfolio = await prisma.portfolio.create({
    data: {
      displayName: `${FIXTURE_PREFIX} ${suffix}`,
      userId: user.id,
      visibility: PortfolioVisibility.PUBLIC,
    },
  });

  return { user, portfolio, username };
}

async function seedProject({
  suffix,
  userId,
  status,
  visibility,
}: {
  suffix: string;
  userId: string;
  status: ProjectStatus;
  visibility: ProjectVisibility;
}) {
  const project = await prisma.project.create({
    data: {
      title: `${FIXTURE_PREFIX} ${suffix}`,
      slug: `${FIXTURE_PREFIX}-${suffix}-${randomUUID()}`,
      shortDescription: "Fixture project.",
      status,
      visibility,
    },
  });

  await prisma.projectMember.create({
    data: { projectId: project.id, userId, role: ProjectRole.OWNER },
  });

  return project;
}

async function cleanup(): Promise<void> {
  await prisma.portfolioProject.deleteMany({
    where: { portfolio: { displayName: { startsWith: FIXTURE_PREFIX } } },
  });

  await prisma.projectMember.deleteMany({
    where: { project: { title: { startsWith: FIXTURE_PREFIX } } },
  });

  await prisma.project.deleteMany({
    where: { title: { startsWith: FIXTURE_PREFIX } },
  });

  await prisma.portfolio.deleteMany({
    where: { displayName: { startsWith: FIXTURE_PREFIX } },
  });

  await prisma.user.deleteMany({
    where: { email: { startsWith: `${FIXTURE_PREFIX}-` } },
  });
}

async function main(): Promise<void> {
  const owner = await seedOwner("owner");

  const actor = { id: owner.user.id, role: PlatformRole.USER, banned: false };

  try {
    console.log("\n== Invariant: editor shows every project regardless of status/visibility, while the owner is a member ==");

    const fixtures: Array<{
      key: string;
      status: ProjectStatus;
      visibility: ProjectVisibility;
    }> = [
      { key: "public-published", status: ProjectStatus.PUBLISHED, visibility: ProjectVisibility.PUBLIC },
      { key: "private", status: ProjectStatus.PUBLISHED, visibility: ProjectVisibility.PRIVATE },
      { key: "draft", status: ProjectStatus.DRAFT, visibility: ProjectVisibility.PUBLIC },
      { key: "unlisted", status: ProjectStatus.PUBLISHED, visibility: ProjectVisibility.UNLISTED },
    ];

    const projects: Record<string, { id: string }> = {};

    for (const fixture of fixtures) {
      const project = await seedProject({
        suffix: fixture.key,
        userId: owner.user.id,
        status: fixture.status,
        visibility: fixture.visibility,
      });

      projects[fixture.key] = project;

      await portfolioProjectService.add({ actor, dto: { projectId: project.id } });
    }

    const editorList = await portfolioProjectService.list({ actor });

    for (const fixture of fixtures) {
      report(
        `editor shows the ${fixture.key} project`,
        editorList.some((entry) => entry.projectId === projects[fixture.key].id),
      );
    }

    console.log("\n== Invariant: public portfolio shows only the public+published, non-hidden project ==");

    const publicPortfolio = await portfolioService.findPublicByUsername({
      username: owner.username,
    });

    const publicProjectIds = new Set(
      publicPortfolio.projects.map((entry) => entry.project.id),
    );

    report(
      "public portfolio includes the public+published project",
      publicProjectIds.has(projects["public-published"].id),
    );
    report(
      "public portfolio excludes the private project",
      !publicProjectIds.has(projects.private.id),
    );
    report(
      "public portfolio excludes the draft project",
      !publicProjectIds.has(projects.draft.id),
    );
    report(
      "public portfolio excludes the unlisted project",
      !publicProjectIds.has(projects.unlisted.id),
    );

    console.log("\n== Invariant: a soft-deleted project disappears from both editor and public views ==");

    await prisma.project.update({
      where: { id: projects["public-published"].id },
      data: { deletedAt: new Date() },
    });

    const editorAfterDelete = await portfolioProjectService.list({ actor });
    const publicAfterDelete = await portfolioService.findPublicByUsername({
      username: owner.username,
    });

    report(
      "editor no longer shows the soft-deleted project",
      !editorAfterDelete.some((entry) => entry.projectId === projects["public-published"].id),
    );
    report(
      "public portfolio no longer shows the soft-deleted project",
      !publicAfterDelete.projects.some((entry) => entry.project.id === projects["public-published"].id),
    );

    // Restore for the membership round trip below.
    await prisma.project.update({
      where: { id: projects["public-published"].id },
      data: { deletedAt: null },
    });

    console.log("\n== Invariant: membership ending removes visibility everywhere; membership recreated restores it ==");

    await prisma.projectMember.delete({
      where: {
        projectId_userId: {
          projectId: projects["public-published"].id,
          userId: owner.user.id,
        },
      },
    });

    const editorAfterMembershipEnd = await portfolioProjectService.list({ actor });
    const publicAfterMembershipEnd = await portfolioService.findPublicByUsername({
      username: owner.username,
    });

    report(
      "editor no longer shows the project after membership ends, though the row still exists",
      !editorAfterMembershipEnd.some((entry) => entry.projectId === projects["public-published"].id),
    );
    report(
      "public portfolio no longer shows the project after membership ends",
      !publicAfterMembershipEnd.projects.some((entry) => entry.project.id === projects["public-published"].id),
    );

    const staleRowStillExists = await prisma.portfolioProject.findUnique({
      where: {
        portfolioId_projectId: {
          portfolioId: owner.portfolio.id,
          projectId: projects["public-published"].id,
        },
      },
    });

    report(
      "the stale relationship row was never destroyed — invisibility is query-time, not cleanup",
      staleRowStillExists !== null,
    );

    await prisma.projectMember.create({
      data: {
        projectId: projects["public-published"].id,
        userId: owner.user.id,
        role: ProjectRole.OWNER,
      },
    });

    const editorAfterRestore = await portfolioProjectService.list({ actor });
    const publicAfterRestore = await portfolioService.findPublicByUsername({
      username: owner.username,
    });

    report(
      "editor shows the project again once membership is recreated",
      editorAfterRestore.some((entry) => entry.projectId === projects["public-published"].id),
    );
    report(
      "public portfolio shows the project again once membership is recreated",
      publicAfterRestore.projects.some((entry) => entry.project.id === projects["public-published"].id),
    );

    console.log("\n== Invariant: DTOs leak no internal fields ==");

    const editorEntry = editorAfterRestore.find(
      (entry) => entry.projectId === projects["public-published"].id,
    ) as unknown as Record<string, unknown>;

    report(
      "editor DTO has no 'hidden' field",
      editorEntry !== undefined && !("hidden" in editorEntry),
    );
    report(
      "editor DTO has no 'deletedAt' field",
      editorEntry !== undefined && !("deletedAt" in editorEntry),
    );

    const publicEntry = publicAfterRestore.projects.find(
      (entry) => entry.project.id === projects["public-published"].id,
    ) as unknown as Record<string, unknown>;

    report(
      "public DTO entry has no 'hidden' field",
      publicEntry !== undefined && !("hidden" in publicEntry),
    );
    report(
      "public project reference has no 'deletedAt' field",
      publicEntry !== undefined &&
        !("deletedAt" in (publicEntry.project as Record<string, unknown>)),
    );
    report(
      "public project reference has no membership/permissions internals",
      publicEntry !== undefined &&
        !("members" in (publicEntry.project as Record<string, unknown>)) &&
        !("permissions" in (publicEntry.project as Record<string, unknown>)),
    );
  } finally {
    await cleanup();
  }

  console.log(`\n${checks - failures}/${checks} checks passed.`);

  await prisma.$disconnect();

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
