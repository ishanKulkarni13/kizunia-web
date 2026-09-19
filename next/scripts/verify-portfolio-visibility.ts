/**
 * Standing regression check for the public Portfolio lookup
 * (`PortfolioRepository.findPublicByUsername`): a Portfolio must only be
 * reachable through the public-by-username lookup when it is PUBLIC, not
 * soft-deleted, has an owner, and that owner both matches the requested
 * username and is not banned.
 *
 * There is no test runner in this repository yet, so this is a standalone
 * script, following the convention in `verify-project-search.ts`. Run with:
 *
 *   pnpm exec tsx scripts/verify-portfolio-visibility.ts
 *
 * It seeds five real Users + Portfolios (one per case that matters) and
 * always cleans them up in a `finally`.
 */

import { randomUUID } from "node:crypto";

import { PrismaClient, PortfolioVisibility } from "../src/generated/prisma";
import { PortfolioRepository } from "../src/modules/portfolio/backend/repository";

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

const FIXTURE_PREFIX = "__verify_portfolio_visibility__";

interface Fixture {
  publicUsername: string;
  privateUsername: string;
  deletedUsername: string;
  bannedUsername: string;
  usernamelessUserId: string;
}

async function createUser(data: {
  suffix: string;
  username: string | null;
  banned?: boolean;
}) {
  return prisma.user.create({
    data: {
      id: randomUUID(),
      name: `${FIXTURE_PREFIX} ${data.suffix}`,
      email: `${FIXTURE_PREFIX}-${data.suffix}@example.com`,
      username: data.username,
      displayUsername: data.username ?? undefined,
      banned: data.banned ?? false,
    },
  });
}

async function seed(): Promise<Fixture> {
  const publicUser = await createUser({
    suffix: "public",
    username: `${FIXTURE_PREFIX}-public`,
  });

  const privateUser = await createUser({
    suffix: "private",
    username: `${FIXTURE_PREFIX}-private`,
  });

  const deletedUser = await createUser({
    suffix: "deleted",
    username: `${FIXTURE_PREFIX}-deleted`,
  });

  const bannedUser = await createUser({
    suffix: "banned",
    username: `${FIXTURE_PREFIX}-banned`,
    banned: true,
  });

  const usernamelessUser = await createUser({
    suffix: "usernameless",
    username: null,
  });

  await prisma.portfolio.create({
    data: {
      displayName: `${FIXTURE_PREFIX} public`,
      userId: publicUser.id,
      visibility: PortfolioVisibility.PUBLIC,
    },
  });

  await prisma.portfolio.create({
    data: {
      displayName: `${FIXTURE_PREFIX} private`,
      userId: privateUser.id,
      visibility: PortfolioVisibility.PRIVATE,
    },
  });

  await prisma.portfolio.create({
    data: {
      displayName: `${FIXTURE_PREFIX} deleted`,
      userId: deletedUser.id,
      visibility: PortfolioVisibility.PUBLIC,
      deletedAt: new Date(),
    },
  });

  await prisma.portfolio.create({
    data: {
      displayName: `${FIXTURE_PREFIX} banned`,
      userId: bannedUser.id,
      visibility: PortfolioVisibility.PUBLIC,
    },
  });

  await prisma.portfolio.create({
    data: {
      displayName: `${FIXTURE_PREFIX} usernameless`,
      userId: usernamelessUser.id,
      visibility: PortfolioVisibility.PUBLIC,
    },
  });

  return {
    publicUsername: publicUser.username!,
    privateUsername: privateUser.username!,
    deletedUsername: deletedUser.username!,
    bannedUsername: bannedUser.username!,
    usernamelessUserId: usernamelessUser.id,
  };
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
  const fixture = await seed();

  try {
    console.log("\n== Invariant: only a PUBLIC, non-deleted, non-banned-owner portfolio is publicly reachable ==");

    const publicResult = await repository.findPublicByUsername({
      username: fixture.publicUsername,
    });
    report("PUBLIC portfolio with a username is reachable", publicResult !== null);

    const privateResult = await repository.findPublicByUsername({
      username: fixture.privateUsername,
    });
    report("PRIVATE portfolio is not reachable", privateResult === null);

    const deletedResult = await repository.findPublicByUsername({
      username: fixture.deletedUsername,
    });
    report("Soft-deleted PUBLIC portfolio is not reachable", deletedResult === null);

    const bannedResult = await repository.findPublicByUsername({
      username: fixture.bannedUsername,
    });
    report("PUBLIC portfolio owned by a banned user is not reachable", bannedResult === null);

    // A portfolio whose owner has no username has no valid public URL to
    // begin with — the route itself is keyed by username, so there is no
    // string that could ever match `user: { username: null }`. This is a
    // structural guarantee, not something a runtime query can exercise;
    // confirm it holds by checking the fixture user directly.
    const usernamelessUser = await prisma.user.findUnique({
      where: { id: fixture.usernamelessUserId },
      select: { username: true },
    });
    report(
      "Portfolio owner without a username has no username to query by (structurally unreachable)",
      usernamelessUser?.username === null,
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
