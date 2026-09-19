// prisma/seed/seeders/users.seeder.ts
import { PrismaClient } from "../../../src/generated/prisma";
import { users } from "../data/users";

export async function seedUsers(prisma: PrismaClient) {
  console.log("  👤 Seeding users...");
  const created: Record<string, string> = {};

  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        // headline: u.headline,
        // bio: u.bio,
        // college: u.college,
        // degree: u.degree,
        // graduationYear: u.graduationYear,
        // location: u.location,
        displayUsername: u.displayUsername,
      },
      create: {
        id: u.id,
        name: u.name,
        email: u.email,
        username: u.username,
        displayUsername: u.displayUsername,
        role: u.role,
        emailVerified: true,
        // headline: u.headline,
        // bio: u.bio,
        // college: u.college,
        // degree: u.degree,
        // graduationYear: u.graduationYear,
        // location: u.location,
        visibility: "PUBLIC",
        status: "ACTIVE",
      },
    });
    created[u.username] = user.id;
    console.log(`     ✓ ${user.name} (${user.email})`);
  }

  return created;
}
