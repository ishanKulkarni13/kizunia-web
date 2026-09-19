// prisma/seed/seeders/taxonomy.seeder.ts
// Seeds technologies, categories, and badges. Returns lookup maps by slug/name.
import { PrismaClient } from "../../../src/generated/prisma";
import { technologies } from "../data/technologies";
import { categories } from "../data/categories";
import { badges } from "../data/badges";

export async function seedTaxonomy(prisma: PrismaClient) {
  console.log("  🏷️  Seeding technologies...");
  const techMap: Record<string, string> = {};
  for (const t of technologies) {
    const tech = await prisma.technology.upsert({
      where: { slug: t.slug },
      update: { name: t.name, description: t.description, type: t.type },
      create: { name: t.name, slug: t.slug, description: t.description, type: t.type },
    });
    techMap[t.slug] = tech.id;
  }
  console.log(`     ✓ ${technologies.length} technologies`);

  console.log("  📂 Seeding categories...");
  const catMap: Record<string, string> = {};
  for (const c of categories) {
    const cat = await prisma.category.upsert({
      where: { slug: c.slug },
      update: { name: c.name },
      create: { name: c.name, slug: c.slug },
    });
    catMap[c.slug] = cat.id;
  }
  console.log(`     ✓ ${categories.length} categories`);

  console.log("  🎖️  Seeding badges...");
  const badgeMap: Record<string, string> = {};
  for (const b of badges) {
    const badge = await prisma.badge.upsert({
      where: { name: b.name },
      update: { description: b.description },
      create: { name: b.name, description: b.description },
    });
    badgeMap[b.name] = badge.id;
  }
  console.log(`     ✓ ${badges.length} badges`);

  return { techMap, catMap, badgeMap };
}
