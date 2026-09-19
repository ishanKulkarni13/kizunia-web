// prisma/seed/seeders/user-enrichment.seeder.ts
// Seeds user categories, badges, and notification preferences.
// Technology is no longer a direct User relationship — PortfolioTechnology
// is the presentation-oriented replacement (seeded separately, if at all).
import { PrismaClient } from "../../../src/generated/prisma";
import { users } from "../data/users";

interface Maps {
  techMap: Record<string, string>;
  catMap: Record<string, string>;
  badgeMap: Record<string, string>;
  userIdList: string[];
}

// Per-user category interests + badges
const userEnrichments: {
  index: number;
  categories: string[];
  badges: string[];
}[] = [
  {
    index: 0, // Priya — admin / organizer
    categories: ["web-dev", "ai", "open-source", "social-impact"],
    badges: ["Verified Organizer", "Community Leader", "Early Adopter"],
  },
  {
    index: 1, // Arjun — ML engineer
    categories: ["ai", "ml", "genai-llms", "data-science"],
    badges: ["Competition Winner", "Rising Star", "Early Adopter"],
  },
  {
    index: 2, // Sara — blockchain dev
    categories: ["web3", "fintech", "open-source"],
    badges: ["Verified Organizer", "Open Source Hero"],
  },
  {
    index: 3, // Rahul — Flutter / mobile
    categories: ["mobile-dev", "iot", "sustainability"],
    badges: ["3x Winner", "Competition Winner"],
  },
  {
    index: 4, // Emily — DevOps / cloud
    categories: ["cloud-devops", "dev-tools", "cybersecurity"],
    badges: ["Verified Organizer", "Top Contributor"],
  },
  {
    index: 5, // Karthik — cybersecurity
    categories: ["cybersecurity", "open-source"],
    badges: ["Bug Hunter", "Competition Winner"],
  },
  {
    index: 6, // Aisha — designer / frontend
    categories: ["design-ux", "web-dev", "edtech"],
    badges: ["Rising Star", "Early Adopter"],
  },
  {
    index: 7, // James — data scientist
    categories: ["ml", "data-science", "healthtech", "ai"],
    badges: ["Top Contributor", "Mentor"],
  },
];

export async function seedUserEnrichment(
  prisma: PrismaClient,
  { catMap, badgeMap, userIdList }: Omit<Maps, "techMap">
) {
  console.log("  🔗 Seeding user categories & badges...");

  for (const enrichment of userEnrichments) {
    const userId = userIdList[enrichment.index];
    if (!userId) continue;

    // Categories
    for (const slug of enrichment.categories) {
      const catId = catMap[slug];
      if (!catId) continue;
      await prisma.userCategory
        .create({ data: { userId, categoryId: catId } })
        .catch(() => {});
    }

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
