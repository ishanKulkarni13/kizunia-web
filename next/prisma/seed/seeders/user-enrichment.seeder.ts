// prisma/seed/seeders/user-enrichment.seeder.ts
// Seeds user badges and notification preferences.
// Technology is no longer a direct User relationship — PortfolioTechnology
// is the presentation-oriented replacement (seeded separately, if at all).
// User category interests were removed from the domain model — see
// docs/architecture/recommendation/README.md for why preference profiles no
// longer come from this table.
import { PrismaClient } from "../../../src/generated/prisma";
import { users } from "../data/users";

interface Maps {
  techMap: Record<string, string>;
  catMap: Record<string, string>;
  badgeMap: Record<string, string>;
  userIdList: string[];
}

// Per-user badges
const userEnrichments: {
  index: number;
  badges: string[];
}[] = [
  {
    index: 0, // Priya — admin / organizer
    badges: ["Verified Organizer", "Community Leader", "Early Adopter"],
  },
  {
    index: 1, // Arjun — ML engineer
    badges: ["Competition Winner", "Rising Star", "Early Adopter"],
  },
  {
    index: 2, // Sara — blockchain dev
    badges: ["Verified Organizer", "Open Source Hero"],
  },
  {
    index: 3, // Rahul — Flutter / mobile
    badges: ["3x Winner", "Competition Winner"],
  },
  {
    index: 4, // Emily — DevOps / cloud
    badges: ["Verified Organizer", "Top Contributor"],
  },
  {
    index: 5, // Karthik — cybersecurity
    badges: ["Bug Hunter", "Competition Winner"],
  },
  {
    index: 6, // Aisha — designer / frontend
    badges: ["Rising Star", "Early Adopter"],
  },
  {
    index: 7, // James — data scientist
    badges: ["Top Contributor", "Mentor"],
  },
];

export async function seedUserEnrichment(
  prisma: PrismaClient,
  { badgeMap, userIdList }: Omit<Maps, "techMap" | "catMap">
) {
  console.log("  🔗 Seeding user badges...");

  for (const enrichment of userEnrichments) {
    const userId = userIdList[enrichment.index];
    if (!userId) continue;

    // Badges
    for (const name of enrichment.badges) {
      const badgeId = badgeMap[name];
      if (!badgeId) continue;
      await prisma.userBadge
        .create({ data: { userId, badgeId } })
        .catch(() => {});
    }

    // Notification preferences (one per user)
    await prisma.notificationPreference
      .upsert({
        where: { userId },
        update: {},
        create: {
          userId,
          emailNotifications: true,
          pushNotifications: enrichment.index < 4, // first 4 users have push on
          preferences: {
            competitionReminders: true,
            newCompetitions: enrichment.index % 2 === 0,
            weeklyDigest: true,
          },
        },
      })
      .catch(() => {});

    console.log(`     ✓ User #${enrichment.index + 1} enriched`);
  }
}
