/**
 * Standing regression check for Portfolio Projects authorization: only the
 * portfolio owner may manage their own relationships, and eligibility to
 * attach a project is membership existence — OWNER, MAINTAINER and
 * CONTRIBUTOR all qualify, non-members and former members do not (except to
 * remove their own stale relationship).
 *
 * There is no id-based route that accepts a client-supplied portfolio id —
 * `portfolioProjectService` resolves the portfolio from `actor.id` alone —
 * so cross-portfolio mutation is demonstrated structurally (two actors, each
 * only ever touching their own relationships) rather than by attempting and
 * rejecting a foreign-id request the API surface does not accept.
 *
 * There is no test runner in this repository yet, so this is a standalone
 * script, following the convention in `verify-portfolio-editor-ownership.ts`.
 * Run with:
 *
 *   pnpm exec tsx scripts/verify-portfolio-projects-authorization.ts
 */

import { randomUUID } from "node:crypto";

import { PrismaClient, ProjectRole } from "../src/generated/prisma";
import { PlatformRole } from "../src/authorization/platform/roles";
import { portfolioProjectService } from "../src/modules/portfolio/backend/portfolio-project.service";
import {
  PortfolioProjectMembershipRequiredError,
  PortfolioProjectNotFoundError,
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

const FIXTURE_PREFIX = "__verify_portfolio_projects_authorization__";

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

async function seedProject(suffix: string) {
  return prisma.project.create({
    data: {
      title: `${FIXTURE_PREFIX} ${suffix}`,
      slug: `${FIXTURE_PREFIX}-${suffix}-${randomUUID()}`,
      shortDescription: "Fixture project.",
    },
  });
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

function isForbidden(error: unknown, ctor: new (...args: never[]) => Error) {
  return error instanceof ctor;
}

async function main(): Promise<void> {
  const a = await seedOwner("actor-a");
  const b = await seedOwner("actor-b");

  const actorA = { id: a.user.id, role: PlatformRole.USER, banned: false };
  const actorB = { id: b.user.id, role: PlatformRole.USER, banned: false };

  try {
    console.log("\n== Invariant: each ProjectRole may add a project they're a member of ==");

    for (const role of [
      ProjectRole.OWNER,
      ProjectRole.MAINTAINER,
      ProjectRole.CONTRIBUTOR,
    ]) {
      const project = await seedProject(`role-${role}`);

      await prisma.projectMember.create({
        data: { projectId: project.id, userId: a.user.id, role },
      });

      const result = await portfolioProjectService.add({
        actor: actorA,
        dto: { projectId: project.id },
      });

      report(
        `${role} can add a project they're a member of`,
        result.some((entry) => entry.projectId === project.id),
      );
    }

    console.log("\n== Invariant: a non-member cannot add a project ==");

    const nonMemberProject = await seedProject("non-member");

    try {
      await portfolioProjectService.add({
        actor: actorA,
        dto: { projectId: nonMemberProject.id },
      });
      report("non-member add is rejected", false, "add unexpectedly succeeded");
    } catch (error) {
      report(
        "non-member add is rejected with membership-required error",
        isForbidden(error, PortfolioProjectMembershipRequiredError),
      );
    }

    console.log("\n== Invariant: a former member cannot add, but CAN remove a stale relationship ==");

    const formerMemberProject = await seedProject("former-member");

    const membership = await prisma.projectMember.create({
      data: {
        projectId: formerMemberProject.id,
        userId: a.user.id,
        role: ProjectRole.CONTRIBUTOR,
      },
    });

    await portfolioProjectService.add({
      actor: actorA,
      dto: { projectId: formerMemberProject.id },
    });

    // Membership ends — no removal workflow exists yet, so this is a direct
    // delete of the ProjectMember row, exactly what a future workflow would
    // do before calling `removeForMembershipEnd`.
    await prisma.projectMember.delete({
      where: {
        projectId_userId: {
          projectId: membership.projectId,
          userId: membership.userId,
        },
      },
    });

    try {
      await portfolioProjectService.add({
        actor: actorA,
        dto: { projectId: formerMemberProject.id },
      });
      report("former member re-add is rejected", false, "add unexpectedly succeeded");
    } catch (error) {
      report(
        "former member cannot re-add a project they left",
        isForbidden(error, PortfolioProjectMembershipRequiredError),
      );
    }

    const afterRemoval = await portfolioProjectService.remove({
      actor: actorA,
      projectId: formerMemberProject.id,
    });

    report(
      "former member can still remove the stale relationship",
      !afterRemoval.some((entry) => entry.projectId === formerMemberProject.id),
    );

    console.log("\n== Invariant: an arbitrary/unknown project id cannot be added ==");

    try {
      await portfolioProjectService.add({
        actor: actorA,
        dto: { projectId: randomUUID() },
      });
      report("unknown project id is rejected", false, "add unexpectedly succeeded");
    } catch (error) {
      report(
        "unknown project id is rejected with membership-required error",
        isForbidden(error, PortfolioProjectMembershipRequiredError),
      );
    }

    console.log("\n== Invariant: actor B cannot mutate actor A's relationships ==");

    const sharedProject = await seedProject("cross-portfolio");

    await prisma.projectMember.createMany({
      data: [
        { projectId: sharedProject.id, userId: a.user.id, role: ProjectRole.OWNER },
        { projectId: sharedProject.id, userId: b.user.id, role: ProjectRole.OWNER },
      ],
    });

    await portfolioProjectService.add({
      actor: actorA,
      dto: { projectId: sharedProject.id },
    });

    try {
      await portfolioProjectService.remove({
        actor: actorB,
        projectId: sharedProject.id,
      });
      report(
        "actor B cannot remove actor A's relationship",
        false,
        "remove unexpectedly succeeded",
      );
    } catch (error) {
      report(
        "actor B's remove on actor A's relationship is rejected as not found",
        isForbidden(error, PortfolioProjectNotFoundError),
      );
    }

    try {
      await portfolioProjectService.setFeatured({
        actor: actorB,
        projectId: sharedProject.id,
        dto: { featured: true },
      });
      report(
        "actor B cannot feature actor A's relationship",
        false,
        "setFeatured unexpectedly succeeded",
      );
    } catch (error) {
      report(
        "actor B's setFeatured on actor A's relationship is rejected as not found",
        isForbidden(error, PortfolioProjectNotFoundError),
      );
    }

    const listA = await portfolioProjectService.list({ actor: actorA });
    const listB = await portfolioProjectService.list({ actor: actorB });

    report(
      "actor A's relationship to the shared project was untouched by actor B's attempts",
      listA.some((entry) => entry.projectId === sharedProject.id && !entry.featured),
    );
    report(
      "actor B's own portfolio remains empty of the shared project",
      !listB.some((entry) => entry.projectId === sharedProject.id),
    );

    console.log("\n== Note: no id-based route accepts a client-supplied portfolioId —");
    console.log("   every mutation resolves the portfolio from actor.id, taken from the session.");
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
