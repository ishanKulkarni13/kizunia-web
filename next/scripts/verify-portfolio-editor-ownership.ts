/**
 * Standing regression check for editor-path IDOR safety: `findMine` and
 * `updateProfile` must only ever read/affect the acting user's own
 * Portfolio. There is no id-based editor route to point at another user's
 * portfolio — every editor query is scoped by `actor.id` taken from the
 * verified session, so this demonstrates the design structurally (two
 * actors, each only ever touching their own row) rather than by attempting
 * and rejecting a foreign-id request that the API surface does not accept.
 *
 * There is no test runner in this repository yet, so this is a standalone
 * script, following the convention in `verify-project-search.ts`. Run with:
 *
 *   pnpm exec tsx scripts/verify-portfolio-editor-ownership.ts
 */

import { randomUUID } from "node:crypto";

import { PrismaClient } from "../src/generated/prisma";
import { PlatformRole } from "../src/authorization/platform/roles";
import { portfolioService } from "../src/modules/portfolio/backend/service";

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

const FIXTURE_PREFIX = "__verify_portfolio_editor_ownership__";

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
      displayName: `${FIXTURE_PREFIX} ${suffix} original`,
      userId: user.id,
    },
  });

  return { user, portfolio };
}

async function cleanup(): Promise<void> {
  await prisma.portfolio.deleteMany({
    where: { displayName: { startsWith: FIXTURE_PREFIX } },
  });

  await prisma.user.deleteMany({
    where: { email: { startsWith: `${FIXTURE_PREFIX}-` } },
  });
}

async function main(): Promise<void> {
  const a = await seedOwner("actor-a");
  const b = await seedOwner("actor-b");

  const actorA = { id: a.user.id, role: PlatformRole.USER, banned: false };
  const actorB = { id: b.user.id, role: PlatformRole.USER, banned: false };

  try {
    console.log("\n== Invariant: findMine only ever returns the acting user's own portfolio ==");

    const foundA = await portfolioService.findMine({ actor: actorA });
    const foundB = await portfolioService.findMine({ actor: actorB });

    report("actor A's findMine returns actor A's portfolio", foundA?.id === a.portfolio.id);
    report("actor B's findMine returns actor B's portfolio", foundB?.id === b.portfolio.id);
    report("actor A's findMine does not return actor B's portfolio", foundA?.id !== b.portfolio.id);

    console.log("\n== Invariant: updateProfile only ever affects the acting user's own portfolio ==");

    await portfolioService.updateProfile({
      actor: actorA,
      dto: { displayName: `${FIXTURE_PREFIX} actor-a updated` },
    });

    const [reloadedA, reloadedB] = await Promise.all([
      prisma.portfolio.findUniqueOrThrow({ where: { id: a.portfolio.id } }),
      prisma.portfolio.findUniqueOrThrow({ where: { id: b.portfolio.id } }),
    ]);

    report(
      "actor A's own portfolio was updated",
      reloadedA.displayName === `${FIXTURE_PREFIX} actor-a updated`,
    );
    report(
      "actor B's portfolio was untouched by actor A's update",
      reloadedB.displayName === `${FIXTURE_PREFIX} actor-b original`,
    );

    console.log("\n== Note: no id-based editor route exists to attempt cross-user access with —");
    console.log("   findMine/updateProfile are scoped by actor.id from the session, not a client-supplied id.");
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
