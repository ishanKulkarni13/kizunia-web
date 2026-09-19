// prisma/seed/seeders/projects.seeder.ts
import { PrismaClient } from "../../../src/generated/prisma";
import { projects } from "../data/projects";

interface Maps {
  techMap: Record<string, string>;
  catMap: Record<string, string>;
  badgeMap: Record<string, string>;
  userIdList: string[];
  competitionMap: Record<string, string>;
}

export async function seedProjects(
  prisma: PrismaClient,
  { techMap, catMap, badgeMap, userIdList, competitionMap }: Maps
) {
  console.log("  🚀 Seeding projects...");

  for (const p of projects) {
    const creatorId = userIdList[p.createdByIndex];

    // ── 1. Upsert project ────────────────────────────────────
    const project = await prisma.project.upsert({
      where: { slug: p.slug },
      update: {
        title: p.title,
        shortDescription: p.shortDescription,
        visibility: p.visibility,
        status: p.status,
        updatedById: creatorId,
      },
      create: {
        title: p.title,
        slug: p.slug,
        shortDescription: p.shortDescription,
        visibility: p.visibility,
        status: p.status,
        createdById: creatorId,
        updatedById: creatorId,
      },
    });

    // ── 2. Members ───────────────────────────────────────────
    for (const m of p.members) {
      await prisma.projectMember
        .upsert({
          where: {
            projectId_userId: {
              projectId: project.id,
              userId: userIdList[m.userIndex],
            },
          },
          update: { role: m.role },
          create: {
            projectId: project.id,
            userId: userIdList[m.userIndex],
            role: m.role,
          },
        })
        .catch(() => {});
    }

    // ── 3. Categories ────────────────────────────────────────
    for (const slug of p.categorySlugs) {
      const catId = catMap[slug];
      if (!catId) continue;
      await prisma.projectCategory
        .create({ data: { projectId: project.id, categoryId: catId } })
        .catch(() => {});
    }

    // ── 4. Technologies ──────────────────────────────────────
    let technologyDisplayOrder = 0;
    for (const slug of p.technologySlugs) {
      const techId = techMap[slug];
      if (!techId) continue;
      await prisma.projectTechnology
        .create({
          data: { projectId: project.id, technologyId: techId, displayOrder: technologyDisplayOrder++ },
        })
        .catch(() => {});
    }

    // ── 5. Competition submissions ─────────────────────────────
    for (const hackSlug of p.competitionSlugs) {
      const hackId = competitionMap[hackSlug];
      if (!hackId) {
        console.warn(`     ⚠ Unknown competition slug: ${hackSlug}`);
        continue;
      }
      await prisma.competitionProject
        .create({
          data: { competitionId: hackId, projectId: project.id },
        })
        .catch(() => {});
    }

    // ── 6. Award "Competition Winner" badge to completed projects ─
    const winnerBadgeId = badgeMap["Competition Winner"];
    if (p.status === "PUBLISHED" && p.visibility === "PUBLIC" && winnerBadgeId) {
      await prisma.projectBadge
        .create({ data: { projectId: project.id, badgeId: winnerBadgeId } })
        .catch(() => {});
    }

    console.log(`     ✓ ${p.title} [${p.status}]`);
  }
}
