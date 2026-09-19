/**
 * Standing regression check for `PortfolioPublicDto` / `PortfolioMapper.toPublicDto`:
 * the public Portfolio response must be an explicit, hand-mapped contract —
 * never a raw Prisma entity passthrough — and must only ever include
 * Projects that are themselves eligible (PUBLIC + PUBLISHED + not hidden +
 * not deleted) AND whose relationship is still backed by an active
 * ProjectMember row for the portfolio owner (see Portfolio Projects'
 * membership invariant in `verify-portfolio-projects-visibility.ts`).
 *
 * There is no test runner in this repository yet, so this is a standalone
 * script, following the convention in `verify-project-search.ts`. Run with:
 *
 *   pnpm exec tsx scripts/verify-portfolio-public-dto.ts
 */

import { randomUUID } from "node:crypto";

import {
  PrismaClient,
  PortfolioVisibility,
  ProjectStatus,
  ProjectVisibility,
} from "../src/generated/prisma";
import { PortfolioRepository } from "../src/modules/portfolio/backend/repository";
import { PortfolioMapper } from "../src/modules/portfolio/backend/mapper/mapper";

const prisma = new PrismaClient();
const repository = new PortfolioRepository(prisma);

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

const FIXTURE_PREFIX = "__verify_portfolio_public_dto__";

async function seed() {
  const user = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: `${FIXTURE_PREFIX} owner`,
      email: `${FIXTURE_PREFIX}@example.com`,
      username: `${FIXTURE_PREFIX}-owner`,
      displayUsername: `${FIXTURE_PREFIX}-owner`,
    },
  });

  const eligibleProject = await prisma.project.create({
    data: {
      title: `${FIXTURE_PREFIX} eligible project`,
      slug: `${FIXTURE_PREFIX}-eligible`,
      shortDescription: "eligible",
      visibility: ProjectVisibility.PUBLIC,
      status: ProjectStatus.PUBLISHED,
    },
  });

  const privateProject = await prisma.project.create({
    data: {
      title: `${FIXTURE_PREFIX} private project`,
      slug: `${FIXTURE_PREFIX}-private`,
      shortDescription: "private",
      visibility: ProjectVisibility.PRIVATE,
      status: ProjectStatus.PUBLISHED,
    },
  });

  const draftProject = await prisma.project.create({
    data: {
      title: `${FIXTURE_PREFIX} draft project`,
      slug: `${FIXTURE_PREFIX}-draft`,
      shortDescription: "draft",
      visibility: ProjectVisibility.PUBLIC,
      status: ProjectStatus.DRAFT,
    },
  });

  const hiddenProject = await prisma.project.create({
    data: {
      title: `${FIXTURE_PREFIX} hidden-reference project`,
      slug: `${FIXTURE_PREFIX}-hidden-ref`,
      shortDescription: "otherwise eligible, but hidden on this portfolio",
      visibility: ProjectVisibility.PUBLIC,
      status: ProjectStatus.PUBLISHED,
    },
  });

  const portfolio = await prisma.portfolio.create({
    data: {
      displayName: `${FIXTURE_PREFIX} portfolio`,
      userId: user.id,
      visibility: PortfolioVisibility.PUBLIC,
      publicContactEmail: `${FIXTURE_PREFIX}-contact@example.com`,
      phone: "+1-555-0100",
      testimonials: {
        create: [
          {
            name: `${FIXTURE_PREFIX} testimonial author`,
            message: "Great work.",
          },
        ],
      },
    },
  });

  // Public visibility of a Portfolio ↔ Project relationship now also
  // requires the portfolio owner to be an active ProjectMember of the
  // project (see visibility.ts / portfolio-project.repository.ts). Grant
  // membership on the two projects expected to pass that check, so this
  // fixture continues to isolate the invariant it's actually testing
  // (visibility/status/hidden) rather than incidentally failing on
  // membership. `privateProject` and `draftProject` are excluded by their
  // own state regardless, so they're left without membership.
  await prisma.projectMember.createMany({
    data: [
      { projectId: eligibleProject.id, userId: user.id },
      { projectId: hiddenProject.id, userId: user.id },
    ],
  });

  await prisma.portfolioProject.createMany({
    data: [
      {
        portfolioId: portfolio.id,
        projectId: eligibleProject.id,
        hidden: false,
        displayOrder: 0,
      },
      {
        portfolioId: portfolio.id,
        projectId: privateProject.id,
        hidden: false,
        displayOrder: 1,
      },
      {
        portfolioId: portfolio.id,
        projectId: draftProject.id,
        hidden: false,
        displayOrder: 2,
      },
      {
        portfolioId: portfolio.id,
        projectId: hiddenProject.id,
        hidden: true,
        displayOrder: 3,
      },
    ],
  });

  return {
    username: user.username!,
    eligibleProjectSlug: eligibleProject.slug,
    privateProjectSlug: privateProject.slug,
    draftProjectSlug: draftProject.slug,
  };
}

async function cleanup(): Promise<void> {
  await prisma.testimonial.deleteMany({
    where: { name: { startsWith: FIXTURE_PREFIX } },
  });

  await prisma.portfolioProject.deleteMany({
    where: { project: { slug: { startsWith: `${FIXTURE_PREFIX}-` } } },
  });

  await prisma.portfolio.deleteMany({
    where: { displayName: { startsWith: FIXTURE_PREFIX } },
  });

  await prisma.project.deleteMany({
    where: { slug: { startsWith: `${FIXTURE_PREFIX}-` } },
  });

  await prisma.user.deleteMany({
    where: { email: { startsWith: FIXTURE_PREFIX } },
  });
}

async function main(): Promise<void> {
  const fixture = await seed();

  try {
    const entity = await repository.findPublicByUsernameOrThrow({
      username: fixture.username,
    });

    const dto = PortfolioMapper.toPublicDto(entity);
    const serialized = JSON.stringify(dto);

    console.log("\n== Invariant: public contact fields are present when set ==");
    report("publicContactEmail is present", dto.publicContactEmail !== null);
    report("phone is present", dto.phone !== null);

    console.log("\n== Invariant: only eligible Projects are included ==");
    const projectSlugs = dto.projects.map((entry) => entry.project.slug);
    report(
      "the eligible (PUBLIC + PUBLISHED, non-hidden) project is included",
      projectSlugs.includes(fixture.eligibleProjectSlug),
    );
    report(
      "the PRIVATE project is excluded",
      !projectSlugs.includes(fixture.privateProjectSlug),
    );
    report(
      "the DRAFT project is excluded",
      !projectSlugs.includes(fixture.draftProjectSlug),
    );
    report("the hidden project-reference is excluded", dto.projects.length === 1);

    console.log("\n== Invariant: Testimonials are included (Portfolio-owned) ==");
    report("the seeded testimonial is present", dto.testimonials.length === 1);

    console.log("\n== Invariant: internal / non-public fields are never present ==");
    report('"userId" is not a top-level key', !("userId" in dto));
    report('"deletedAt" is not a top-level key', !("deletedAt" in dto));
    report('"visibility" is not a top-level key', !("visibility" in dto));
    report('"userId" does not appear anywhere in the serialized response', !serialized.includes('"userId"'));
    report('"deletedAt" does not appear anywhere in the serialized response', !serialized.includes('"deletedAt"'));
    report('user.id is not present', !("id" in dto.user));
    report('user.name is not present', !("name" in (dto.user as object)));
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
