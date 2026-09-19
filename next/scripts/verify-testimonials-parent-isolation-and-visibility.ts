/**
 * Standing regression check for Testimonial parent isolation, public
 * visibility inheritance, and DTO safety.
 *
 * Covers what the per-domain authorization scripts don't:
 *  - a Project-owned and a Portfolio-owned testimonial never cross-appear,
 *    even though both live in the same `testimonial` table;
 *  - a Project that isn't publicly viewable never leaks its testimonials
 *    through the public route, regardless of testimonial content;
 *  - the public DTO never leaks internal fields (deletedAt, raw FK ids,
 *    authorization metadata).
 *
 * Run with:
 *
 *   pnpm exec tsx scripts/verify-testimonials-parent-isolation-and-visibility.ts
 */

import { randomUUID } from "node:crypto";

import {
  PrismaClient,
  ProjectRole,
  ProjectStatus,
  ProjectVisibility,
} from "../src/generated/prisma";
import { PlatformRole } from "../src/authorization/platform/roles";
import { projectService } from "../src/modules/projects/backend/service";
import { projectTestimonialService } from "../src/modules/projects/backend/project-testimonial.service";
import { portfolioTestimonialService } from "../src/modules/portfolio/backend/portfolio-testimonial.service";

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

const FIXTURE_PREFIX = "__verify_testimonials_isolation__";

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

async function seedProject(
  suffix: string,
  overrides: Partial<{ status: ProjectStatus; visibility: ProjectVisibility }> = {},
) {
  return prisma.project.create({
    data: {
      title: `${FIXTURE_PREFIX} ${suffix}`,
      slug: `${FIXTURE_PREFIX}-${suffix}-${randomUUID()}`,
      shortDescription: "Fixture project.",
      status: overrides.status ?? ProjectStatus.PUBLISHED,
      visibility: overrides.visibility ?? ProjectVisibility.PUBLIC,
    },
  });
}

async function cleanup(): Promise<void> {
  await prisma.testimonial.deleteMany({
    where: {
      OR: [
        { project: { title: { startsWith: FIXTURE_PREFIX } } },
        { portfolio: { displayName: { startsWith: FIXTURE_PREFIX } } },
      ],
    },
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

const ALLOWED_PUBLIC_TESTIMONIAL_KEYS = new Set([
  "id",
  "name",
  "position",
  "company",
  "message",
  "rating",
  "displayOrder",
  "image",
]);

async function main(): Promise<void> {
  const owner = await seedOwner("owner");
  const actor = { id: owner.user.id, role: PlatformRole.USER, banned: false };
  const anonymousActor = { id: undefined, role: PlatformRole.USER, banned: false };

  try {
    console.log("\n== Invariant: a Project testimonial and a Portfolio testimonial never cross-appear ==");

    const project = await seedProject("cross-parent");

    await prisma.projectMember.create({
      data: { projectId: project.id, userId: owner.user.id, role: ProjectRole.OWNER },
    });

    const [projectTestimonial] = await projectTestimonialService.add({
      projectId: project.id,
      actor,
      dto: { name: "Project person", message: "From the project." },
    });

    const [portfolioTestimonial] = await portfolioTestimonialService.add({
      actor,
      dto: { name: "Portfolio person", message: "From the portfolio." },
    });

    const projectList = await projectTestimonialService.list({
      projectId: project.id,
      actor,
    });
    const portfolioList = await portfolioTestimonialService.list({ actor });

    report(
      "the project's testimonial list contains only the project testimonial",
      projectList.some((t) => t.id === projectTestimonial.id) &&
        !projectList.some((t) => t.id === portfolioTestimonial.id),
    );

    report(
      "the portfolio's testimonial list contains only the portfolio testimonial",
      portfolioList.some((t) => t.id === portfolioTestimonial.id) &&
        !portfolioList.some((t) => t.id === projectTestimonial.id),
    );

    const rawProjectTestimonial = await prisma.testimonial.findUniqueOrThrow({
      where: { id: projectTestimonial.id },
    });
    const rawPortfolioTestimonial = await prisma.testimonial.findUniqueOrThrow({
      where: { id: portfolioTestimonial.id },
    });

    report(
      "the Project testimonial has exactly one parent set (projectId, no portfolioId)",
      rawProjectTestimonial.projectId === project.id &&
        rawProjectTestimonial.portfolioId === null,
    );
    report(
      "the Portfolio testimonial has exactly one parent set (portfolioId, no projectId)",
      rawPortfolioTestimonial.portfolioId === owner.portfolio.id &&
        rawPortfolioTestimonial.projectId === null,
    );

    console.log("\n== Invariant: public visibility is inherited from the parent Project ==");

    const publicProject = await seedProject("public", {
      status: ProjectStatus.PUBLISHED,
      visibility: ProjectVisibility.PUBLIC,
    });

    await prisma.projectMember.create({
      data: { projectId: publicProject.id, userId: owner.user.id, role: ProjectRole.OWNER },
    });

    await projectTestimonialService.add({
      projectId: publicProject.id,
      actor,
      dto: { name: "Public testimonial", message: "Visible to everyone." },
    });

    const publicDto = await projectService.findPublicBySlug({
      slug: publicProject.slug,
      actor: anonymousActor,
    });

    report(
      "a PUBLIC + PUBLISHED project's testimonials are visible anonymously",
      publicDto.testimonials.some((t) => t.name === "Public testimonial"),
    );

    const draftProject = await seedProject("draft", {
      status: ProjectStatus.DRAFT,
      visibility: ProjectVisibility.PUBLIC,
    });

    await prisma.projectMember.create({
      data: { projectId: draftProject.id, userId: owner.user.id, role: ProjectRole.OWNER },
    });

    await projectTestimonialService.add({
      projectId: draftProject.id,
      actor,
      dto: { name: "Draft testimonial", message: "Should not leak." },
    });

    let draftLeaked = false;

    try {
      await projectService.findPublicBySlug({
        slug: draftProject.slug,
        actor: anonymousActor,
      });
      draftLeaked = true;
    } catch {
      // Expected: a DRAFT project is not publicly viewable, so the whole
      // lookup fails before any testimonial content could be read.
    }

    report(
      "a DRAFT project's testimonials never leak through the public route",
      !draftLeaked,
    );

    const privateProject = await seedProject("private", {
      status: ProjectStatus.PUBLISHED,
      visibility: ProjectVisibility.PRIVATE,
    });

    await prisma.projectMember.create({
      data: { projectId: privateProject.id, userId: owner.user.id, role: ProjectRole.OWNER },
    });

    await projectTestimonialService.add({
      projectId: privateProject.id,
      actor,
      dto: { name: "Private testimonial", message: "Should not leak." },
    });

    let privateLeaked = false;

    try {
      await projectService.findPublicBySlug({
        slug: privateProject.slug,
        actor: anonymousActor,
      });
      privateLeaked = true;
    } catch {
      // Expected: a PRIVATE project is not publicly viewable.
    }

    report(
      "a PRIVATE project's testimonials never leak through the public route",
      !privateLeaked,
    );

    console.log("\n== Invariant: public testimonial DTO does not leak internal fields ==");

    for (const entry of publicDto.testimonials) {
      const keys = Object.keys(entry);
      const unexpected = keys.filter((key) => !ALLOWED_PUBLIC_TESTIMONIAL_KEYS.has(key));

      report(
        `public testimonial "${entry.name}" exposes only the documented fields`,
        unexpected.length === 0,
        unexpected.length > 0 ? `unexpected keys: ${unexpected.join(", ")}` : undefined,
      );
    }

    console.log("\n== Invariant: public testimonials render in displayOrder order ==");

    const orderingProject = await seedProject("ordering", {
      status: ProjectStatus.PUBLISHED,
      visibility: ProjectVisibility.PUBLIC,
    });

    await prisma.projectMember.create({
      data: { projectId: orderingProject.id, userId: owner.user.id, role: ProjectRole.OWNER },
    });

    const [first] = await projectTestimonialService.add({
      projectId: orderingProject.id,
      actor,
      dto: { name: "First", message: "First." },
    });
    const secondBatch = await projectTestimonialService.add({
      projectId: orderingProject.id,
      actor,
      dto: { name: "Second", message: "Second." },
    });
    const second = secondBatch.find((t) => t.name === "Second")!;

    await projectTestimonialService.reorder({
      projectId: orderingProject.id,
      actor,
      dto: { ids: [second.id, first.id] },
    });

    const orderedPublicDto = await projectService.findPublicBySlug({
      slug: orderingProject.slug,
      actor: anonymousActor,
    });

    report(
      "the public page reflects server-assigned displayOrder, not creation order",
      orderedPublicDto.testimonials[0]?.name === "Second" &&
        orderedPublicDto.testimonials[1]?.name === "First",
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
