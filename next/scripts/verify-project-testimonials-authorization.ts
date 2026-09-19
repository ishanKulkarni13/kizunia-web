/**
 * Standing regression check for Project Testimonials: authorization,
 * CRUD, ordering, image handling, and parent isolation.
 *
 * Locked product decision (see plan): CONTRIBUTOR is VIEW-ONLY for
 * testimonials — only OWNER and MAINTAINER may manage them. This is the
 * opposite of Portfolio Projects' membership-only rule, so it is verified
 * explicitly here rather than assumed from that script's pattern.
 *
 * There is no test runner in this repository yet, so this is a standalone
 * script, following the convention in `verify-portfolio-projects-authorization.ts`.
 * Run with:
 *
 *   pnpm exec tsx scripts/verify-project-testimonials-authorization.ts
 */

import { randomUUID } from "node:crypto";

import { PrismaClient, ProjectRole } from "../src/generated/prisma";
import { PlatformRole } from "../src/authorization/platform/roles";
import { projectTestimonialService } from "../src/modules/projects/backend/project-testimonial.service";
import { ProjectTestimonialNotFoundError } from "../src/modules/projects/backend/errors";
import { ForbiddenError, ValidationError } from "../src/lib/errors";

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

const FIXTURE_PREFIX = "__verify_project_testimonials__";

async function seedUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: randomUUID(),
      name: `${FIXTURE_PREFIX} ${suffix}`,
      email: `${FIXTURE_PREFIX}-${suffix}@example.com`,
    },
  });
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
  await prisma.testimonial.deleteMany({
    where: { project: { title: { startsWith: FIXTURE_PREFIX } } },
  });

  await prisma.projectMember.deleteMany({
    where: { project: { title: { startsWith: FIXTURE_PREFIX } } },
  });

  await prisma.project.deleteMany({
    where: { title: { startsWith: FIXTURE_PREFIX } },
  });

  await prisma.user.deleteMany({
    where: { email: { startsWith: `${FIXTURE_PREFIX}-` } },
  });
}

function isInstance(error: unknown, ctor: new (...args: never[]) => Error) {
  return error instanceof ctor;
}

async function main(): Promise<void> {
  const owner = await seedUser("owner");
  const outsider = await seedUser("outsider");

  const actorOwner = { id: owner.id, role: PlatformRole.USER, banned: false };
  const actorOutsider = { id: outsider.id, role: PlatformRole.USER, banned: false };

  try {
    console.log("\n== Invariant: OWNER and MAINTAINER can manage; CONTRIBUTOR cannot ==");

    for (const role of [ProjectRole.OWNER, ProjectRole.MAINTAINER]) {
      const project = await seedProject(`manage-${role}`);

      await prisma.projectMember.create({
        data: { projectId: project.id, userId: owner.id, role },
      });

      const result = await projectTestimonialService.add({
        projectId: project.id,
        actor: actorOwner,
        dto: { name: "Jane Doe", message: "Great to work with!" },
      });

      report(
        `${role} can create a testimonial`,
        result.some((t) => t.name === "Jane Doe"),
      );

      const testimonialId = result[0].id;

      const reordered = await projectTestimonialService.reorder({
        projectId: project.id,
        actor: actorOwner,
        dto: { ids: [testimonialId] },
      });
      report(`${role} can reorder testimonials`, reordered.length === 1);

      const updated = await projectTestimonialService.update({
        projectId: project.id,
        testimonialId,
        actor: actorOwner,
        dto: { rating: 5 },
      });
      report(
        `${role} can update a testimonial`,
        updated[0].rating === 5,
      );

      const removed = await projectTestimonialService.remove({
        projectId: project.id,
        testimonialId,
        actor: actorOwner,
      });
      report(`${role} can delete a testimonial`, removed.length === 0);
    }

    const contributorProject = await seedProject("contributor");

    await prisma.projectMember.create({
      data: {
        projectId: contributorProject.id,
        userId: owner.id,
        role: ProjectRole.CONTRIBUTOR,
      },
    });

    try {
      await projectTestimonialService.add({
        projectId: contributorProject.id,
        actor: actorOwner,
        dto: { name: "Should fail", message: "Should not be created." },
      });
      report("CONTRIBUTOR cannot create a testimonial", false, "add unexpectedly succeeded");
    } catch (error) {
      report(
        "CONTRIBUTOR create is rejected as forbidden",
        isInstance(error, ForbiddenError),
      );
    }

    console.log("\n== Invariant: a non-member cannot manage testimonials ==");

    const nonMemberProject = await seedProject("non-member");

    try {
      await projectTestimonialService.add({
        projectId: nonMemberProject.id,
        actor: actorOutsider,
        dto: { name: "Should fail", message: "Should not be created." },
      });
      report("non-member cannot create a testimonial", false, "add unexpectedly succeeded");
    } catch (error) {
      report(
        "non-member create is rejected as forbidden",
        isInstance(error, ForbiddenError),
      );
    }

    console.log("\n== Invariant: a former member loses access ==");

    const formerMemberProject = await seedProject("former-member");

    await prisma.projectMember.create({
      data: {
        projectId: formerMemberProject.id,
        userId: outsider.id,
        role: ProjectRole.OWNER,
      },
    });

    await prisma.projectMember.delete({
      where: {
        projectId_userId: {
          projectId: formerMemberProject.id,
          userId: outsider.id,
        },
      },
    });

    try {
      await projectTestimonialService.add({
        projectId: formerMemberProject.id,
        actor: actorOutsider,
        dto: { name: "Should fail", message: "Should not be created." },
      });
      report("former member cannot create a testimonial", false, "add unexpectedly succeeded");
    } catch (error) {
      report(
        "former member create is rejected as forbidden",
        isInstance(error, ForbiddenError),
      );
    }

    console.log("\n== Invariant: cross-project access is rejected as not found, not forbidden ==");

    const projectA = await seedProject("cross-a");
    const projectB = await seedProject("cross-b");

    await prisma.projectMember.create({
      data: { projectId: projectA.id, userId: owner.id, role: ProjectRole.OWNER },
    });
    await prisma.projectMember.create({
      data: { projectId: projectB.id, userId: owner.id, role: ProjectRole.OWNER },
    });

    const [testimonialA] = await projectTestimonialService.add({
      projectId: projectA.id,
      actor: actorOwner,
      dto: { name: "Project A testimonial", message: "Belongs to A." },
    });

    try {
      await projectTestimonialService.update({
        projectId: projectB.id,
        testimonialId: testimonialA.id,
        actor: actorOwner,
        dto: { name: "Hijacked" },
      });
      report(
        "testimonial A cannot be updated through project B's route",
        false,
        "update unexpectedly succeeded",
      );
    } catch (error) {
      report(
        "testimonial A via project B is rejected as not found",
        isInstance(error, ProjectTestimonialNotFoundError),
      );
    }

    const listA = await projectTestimonialService.list({
      projectId: projectA.id,
      actor: actorOwner,
    });
    const listB = await projectTestimonialService.list({
      projectId: projectB.id,
      actor: actorOwner,
    });

    report(
      "project A's testimonial is untouched and still only in A's list",
      listA.some((t) => t.id === testimonialA.id) &&
        !listB.some((t) => t.id === testimonialA.id),
    );

    console.log("\n== Invariant: rating bounds, ordering, and reorder validation ==");

    const validationProject = await seedProject("validation");

    await prisma.projectMember.create({
      data: { projectId: validationProject.id, userId: owner.id, role: ProjectRole.OWNER },
    });

    try {
      await projectTestimonialService.add({
        projectId: validationProject.id,
        actor: actorOwner,
        dto: { name: "Bad rating", message: "x", rating: 6 as never },
      });
      report("rating > 5 is rejected", false, "add unexpectedly succeeded (rating not schema-validated in service directly — expected, Zod validates at controller layer)");
    } catch {
      report("rating > 5 is rejected (or bypasses service-level type, validated at Zod layer)", true);
    }

    const t1 = await projectTestimonialService.add({
      projectId: validationProject.id,
      actor: actorOwner,
      dto: { name: "First", message: "First testimonial." },
    });
    const t2 = await projectTestimonialService.add({
      projectId: validationProject.id,
      actor: actorOwner,
      dto: { name: "Second", message: "Second testimonial." },
    });

    const firstId = t1[0].id;
    const secondId = t2.find((t) => t.name === "Second")!.id;

    report(
      "new testimonials append in creation order by default",
      t2[0].id === firstId && t2[1].id === secondId,
    );

    const reorderedList = await projectTestimonialService.reorder({
      projectId: validationProject.id,
      actor: actorOwner,
      dto: { ids: [secondId, firstId] },
    });

    report(
      "reorder persists the submitted order",
      reorderedList[0].id === secondId && reorderedList[1].id === firstId,
    );

    const beforeMismatch = await projectTestimonialService.list({
      projectId: validationProject.id,
      actor: actorOwner,
    });

    try {
      await projectTestimonialService.reorder({
        projectId: validationProject.id,
        actor: actorOwner,
        dto: { ids: [secondId] }, // missing firstId
      });
      report("reorder with a missing id is rejected", false, "reorder unexpectedly succeeded");
    } catch (error) {
      report(
        "reorder with a missing id is rejected as a validation error",
        isInstance(error, ValidationError),
      );
    }

    try {
      await projectTestimonialService.reorder({
        projectId: validationProject.id,
        actor: actorOwner,
        dto: { ids: [secondId, secondId] }, // duplicate
      });
      report("reorder with a duplicate id is rejected", false, "reorder unexpectedly succeeded");
    } catch (error) {
      report(
        "reorder with a duplicate id is rejected as a validation error",
        isInstance(error, ValidationError),
      );
    }

    try {
      await projectTestimonialService.reorder({
        projectId: validationProject.id,
        actor: actorOwner,
        dto: { ids: [secondId, firstId, randomUUID()] }, // foreign id
      });
      report("reorder with a foreign id is rejected", false, "reorder unexpectedly succeeded");
    } catch (error) {
      report(
        "reorder with a foreign id is rejected as a validation error",
        isInstance(error, ValidationError),
      );
    }

    const afterMismatch = await projectTestimonialService.list({
      projectId: validationProject.id,
      actor: actorOwner,
    });

    report(
      "a rejected reorder leaves ordering unchanged (transaction rollback)",
      afterMismatch[0].id === beforeMismatch[0].id &&
        afterMismatch[1].id === beforeMismatch[1].id,
    );

    console.log("\n== Invariant: same-asset-id update is a safe no-op ==");

    const noopUpdate1 = await projectTestimonialService.update({
      projectId: validationProject.id,
      testimonialId: firstId,
      actor: actorOwner,
      dto: { imageAssetId: null },
    });
    const noopUpdate2 = await projectTestimonialService.update({
      projectId: validationProject.id,
      testimonialId: firstId,
      actor: actorOwner,
      dto: { imageAssetId: null },
    });

    report(
      "re-submitting the same (null) imageAssetId does not error",
      noopUpdate1.length > 0 && noopUpdate2.length > 0,
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
