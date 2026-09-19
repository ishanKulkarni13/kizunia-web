// prisma/seed/seeders/competitions.seeder.ts
import { PrismaClient } from "../../../src/generated/prisma";
import { normalizeLocationInput } from "../../../src/modules/locations/utils/normalize";
import { competitions } from "../data/competitions";
import { users } from "../data/users";

interface Maps {
  techMap: Record<string, string>;
  catMap: Record<string, string>;
  userIdList: string[];
}

export async function seedCompetitions(
  prisma: PrismaClient,
  { techMap, catMap, userIdList }: Maps
) {
  console.log("  🏆 Seeding competitions...");
  const competitionMap: Record<string, string> = {};

  for (const h of competitions) {
    // ── 1. Upsert the competition ──────────────────────────────
    const hack = await prisma.competition.upsert({
      where: { slug: h.slug },
      update: {
        title: h.title,
        shortDescription: h.shortDescription,
        organizer: h.organizer,
        mode: h.mode,
        status: h.status,
        visibility: h.visibility,
        startDate: h.startDate,
        endDate: h.endDate,
        registrationDeadline: h.registrationDeadline,
        prizePool: h.prizePool,
        minTeamSize: h.minTeamSize,
        maxTeamSize: h.maxTeamSize,
        registrationPlatform: h.registrationPlatform,
        registrationType: h.registrationType,
        registrationFeeType: h.registrationFeeType,
        registrationFee: h.registrationFee,
        organizerType: h.organizerType,
        difficulty: h.difficulty,
        certificateType: h.certificateType,
        website: h.website,
        registrationLink: h.registrationLink,
      },
      create: {
        title: h.title,
        slug: h.slug,
        shortDescription: h.shortDescription,
        organizer: h.organizer,
        mode: h.mode,
        status: h.status,
        visibility: h.visibility,
        startDate: h.startDate,
        endDate: h.endDate,
        registrationDeadline: h.registrationDeadline,
        prizePool: h.prizePool,
        minTeamSize: h.minTeamSize,
        maxTeamSize: h.maxTeamSize,
        registrationPlatform: h.registrationPlatform,
        registrationType: h.registrationType,
        registrationFeeType: h.registrationFeeType,
        registrationFee: h.registrationFee,
        organizerType: h.organizerType,
        difficulty: h.difficulty,
        certificateType: h.certificateType,
        website: h.website,
        registrationLink: h.registrationLink,
        createdById: userIdList[h.ownerIndex],
      },
    });
    competitionMap[h.slug] = hack.id;

    // ── 2. Owner member ──────────────────────────────────────
    await prisma.competitionMember.upsert({
      where: {
        competitionId_userId: {
          competitionId: hack.id,
          userId: userIdList[h.ownerIndex],
        },
      },
      update: {},
      create: {
        competitionId: hack.id,
        userId: userIdList[h.ownerIndex],
        role: "OWNER",
      },
    });

    // ── 3. Extra members ──────────────────────────────────────
    for (const m of h.members) {
      await prisma.competitionMember
        .upsert({
          where: {
            competitionId_userId: {
              competitionId: hack.id,
              userId: userIdList[m.userIndex],
            },
          },
          update: { role: m.role },
          create: {
            competitionId: hack.id,
            userId: userIdList[m.userIndex],
            role: m.role,
          },
        })
        .catch(() => {}); // skip if same user already owner
    }

    // ── 4. Categories ─────────────────────────────────────────
    for (const slug of h.categorySlugs) {
      const catId = catMap[slug];
      if (!catId) {
        console.warn(`     ⚠ Unknown category slug: ${slug}`);
        continue;
      }
      await prisma.competitionCategory
        .create({ data: { competitionId: hack.id, categoryId: catId } })
        .catch(() => {}); // ignore duplicate
    }

    // ── 5. Technologies ───────────────────────────────────────
    for (const slug of h.technologySlugs) {
      const techId = techMap[slug];
      if (!techId) {
        console.warn(`     ⚠ Unknown technology slug: ${slug}`);
        continue;
      }
      await prisma.competitionTechnology
        .create({ data: { competitionId: hack.id, technologyId: techId } })
        .catch(() => {}); // ignore duplicate
    }

    // ── 6. Eligibilities ──────────────────────────────────────
    for (const type of h.eligibilities) {
      await prisma.competitionEligibility
        .create({ data: { competitionId: hack.id, type } })
        .catch(() => {}); // ignore duplicate
    }

    // ── 7. Location ───────────────────────────────────────────
    // Seed locations are free text, so they are stored exactly as a manual
    // entry would be: a display name at UNKNOWN precision, with no structured
    // fields invented. Cleared first so re-seeding does not stack duplicates.
    const staleLinks = await prisma.competitionLocation.findMany({
      where: { competitionId: hack.id },
      select: { locationId: true },
    });

    await prisma.competitionLocation.deleteMany({
      where: { competitionId: hack.id },
    });

    // Locations belong to one competition, so unlinking makes them unreachable.
    await prisma.location.deleteMany({
      where: { id: { in: staleLinks.map((link) => link.locationId) } },
    });

    if (h.location) {
      const input = normalizeLocationInput({ displayName: h.location });

      const place = await prisma.location.create({ data: input });

      await prisma.competitionLocation.create({
        data: { competitionId: hack.id, locationId: place.id, order: 0 },
      });

      // No SearchAreas: seed locations are free text with nothing verifying
      // where they are. They render correctly on a competition but are not
      // discoverable by location until re-added through the place picker,
      // which is the same rule that applies to any manually typed location.
    }

    console.log(`     ✓ ${h.title} [${h.status}] [${h.visibility}]`);
  }

  // ── 7. Add some bookmarks for realism ──────────────────────
  const bookmarks: [string, number][] = [
    ["ethglobal-new-delhi-2026", 1],
    ["ethglobal-new-delhi-2026", 3],
    ["sih-2026", 2],
    ["sih-2026", 5],
    ["mlh-ghw-ai-2026", 6],
    ["hackmit-2026", 0],
    ["hackmit-2026", 7],
    ["defi-builders-summit-2026", 1],
    ["cyberstrike-ctf-2026", 3],
  ];
  for (const [slug, uIdx] of bookmarks) {
    const hid = competitionMap[slug];
    const uid = userIdList[uIdx];
    if (hid && uid) {
      await prisma.competitionBookmark
        .create({ data: { competitionId: hid, userId: uid } })
        .catch(() => {});
    }
  }
  console.log(`     ✓ ${bookmarks.length} bookmarks added`);

  return competitionMap;
}
