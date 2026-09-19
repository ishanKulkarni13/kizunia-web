/**
 * Standing regression check for the Portfolio Projects relationship itself:
 * add/duplicate/remove/feature/unfeature/reorder, and that the database's
 * composite primary key — not application logic alone — is the authority on
 * duplicates.
 *
 * There is no test runner in this repository yet, so this is a standalone
 * script, following the convention in `verify-portfolio-editor-ownership.ts`.
 * Run with:
 *
 *   pnpm exec tsx scripts/verify-portfolio-projects-relationship.ts
 */

import { randomUUID } from "node:crypto";

import { PrismaClient, ProjectRole } from "../src/generated/prisma";
import { PlatformRole } from "../src/authorization/platform/roles";
import { portfolioProjectService } from "../src/modules/portfolio/backend/portfolio-project.service";
import {
  PortfolioProjectAlreadyExistsError,
  PortfolioProjectReorderMismatchError,
} from "../src/modules/portfolio/errors";

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

const FIXTURE_PREFIX = "__verify_portfolio_projects_relationship__";

async function seedOwner(suffix: string) {
  const user = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: `${FIXTURE_PREFIX} ${suffix}`,
      email: `${FIXTURE_PREFIX}-${suffix}@example.com`,
    },
  });

  const portfolio = await prisma.portfolio.create({
    data: {
      displayName: `${FIXTURE_PREFIX} ${suffix}`,
      userId: user.id,
    },
  });

  return { user, portfolio };
}

async function seedProjectWithMembership(suffix: string, userId: string) {
  const project = await prisma.project.create({
    data: {
      title: `${FIXTURE_PREFIX} ${suffix}`,
      slug: `${FIXTURE_PREFIX}-${suffix}-${randomUUID()}`,
      shortDescription: "Fixture project.",
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
  const other = await seedOwner("other-owner");

  const actor = { id: owner.user.id, role: PlatformRole.USER, banned: false };

  try {
    console.log("\n== Invariant: add succeeds and duplicate add is rejected by the composite key ==");

    const projectOne = await seedProjectWithMembership("one", owner.user.id);
    const projectTwo = await seedProjectWithMembership("two", owner.user.id);

    await portfolioProjectService.add({ actor, dto: { projectId: projectOne.id } });

    const rowCountBefore = await prisma.portfolioProject.count({
      where: { portfolioId: owner.portfolio.id, projectId: projectOne.id },
    });

    report("add creates exactly one relationship row", rowCountBefore === 1);

    try {
      await portfolioProjectService.add({ actor, dto: { projectId: projectOne.id } });
      report("duplicate add is rejected", false, "add unexpectedly succeeded");
    } catch (error) {
      report(
        "duplicate add is rejected with a 409 conflict error",
        error instanceof PortfolioProjectAlreadyExistsError,
      );
    }

    const rowCountAfter = await prisma.portfolioProject.count({
      where: { portfolioId: owner.portfolio.id, projectId: projectOne.id },
    });

    report("duplicate attempt did not create a second row", rowCountAfter === 1);

    console.log("\n== Invariant: displayOrder is assigned monotonically on add ==");

    const listAfterTwoAdds = await portfolioProjectService.add({
      actor,
      dto: { projectId: projectTwo.id },
    });

    const orderOne = listAfterTwoAdds.find((entry) => entry.projectId === projectOne.id)?.displayOrder;
    const orderTwo = listAfterTwoAdds.find((entry) => entry.projectId === projectTwo.id)?.displayOrder;

    report(
      "second add is ordered after the first",
      orderOne !== undefined && orderTwo !== undefined && orderTwo > orderOne,
    );

    console.log("\n== Invariant: feature / unfeature ==");

    const featuredList = await portfolioProjectService.setFeatured({
      actor,
      projectId: projectOne.id,
      dto: { featured: true },
    });

    report(
      "feature sets featured to true",
      featuredList.find((entry) => entry.projectId === projectOne.id)?.featured === true,
    );

    const unfeaturedList = await portfolioProjectService.setFeatured({
      actor,
      projectId: projectOne.id,
      dto: { featured: false },
    });

    report(
      "unfeature sets featured back to false",
      unfeaturedList.find((entry) => entry.projectId === projectOne.id)?.featured === false,
    );

    console.log("\n== Invariant: reorder rewrites displayOrder for a valid exact-cover request ==");

    const reordered = await portfolioProjectService.reorder({
      actor,
      dto: { projectIds: [projectTwo.id, projectOne.id] },
    });

    const reorderedOne = reordered.find((entry) => entry.projectId === projectOne.id)?.displayOrder;
    const reorderedTwo = reordered.find((entry) => entry.projectId === projectTwo.id)?.displayOrder;

    report(
      "reorder places projectTwo before projectOne",
      reorderedTwo !== undefined && reorderedOne !== undefined && reorderedTwo < reorderedOne,
    );

    console.log("\n== Invariant: an invalid reorder (missing id) is rejected and leaves order unchanged ==");

    const beforeInvalidReorder = await portfolioProjectService.list({ actor });

    try {
      await portfolioProjectService.reorder({
        actor,
        dto: { projectIds: [projectOne.id] }, // omits projectTwo
      });
      report("reorder with a missing id is rejected", false, "reorder unexpectedly succeeded");
    } catch (error) {
      report(
        "reorder with a missing id is rejected with a 422 error",
        error instanceof PortfolioProjectReorderMismatchError,
      );
    }

    const afterInvalidReorder = await portfolioProjectService.list({ actor });

    report(
      "order is unchanged after the rejected reorder",
      JSON.stringify(beforeInvalidReorder.map((entry) => [entry.projectId, entry.displayOrder])) ===
        JSON.stringify(afterInvalidReorder.map((entry) => [entry.projectId, entry.displayOrder])),
    );

    console.log("\n== Invariant: remove detaches the relationship without touching the project ==");

    const afterRemove = await portfolioProjectService.remove({
      actor,
      projectId: projectOne.id,
    });

    report(
      "removed project no longer appears in the list",
      !afterRemove.some((entry) => entry.projectId === projectOne.id),
    );

    const projectStillExists = await prisma.project.findUnique({
      where: { id: projectOne.id },
    });

    report("the Project row itself still exists after removal", projectStillExists !== null);

    console.log("\n== Invariant: the same project may appear in multiple portfolios ==");

    await prisma.projectMember.create({
      data: { projectId: projectTwo.id, userId: other.user.id, role: ProjectRole.CONTRIBUTOR },
    });

    const otherActor = { id: other.user.id, role: PlatformRole.USER, banned: false };

    const otherList = await portfolioProjectService.add({
      actor: otherActor,
      dto: { projectId: projectTwo.id },
    });

    const ownerList = await portfolioProjectService.list({ actor });

    report(
      "the shared project appears in both portfolios independently",
      otherList.some((entry) => entry.projectId === projectTwo.id) &&
        ownerList.some((entry) => entry.projectId === projectTwo.id),
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
