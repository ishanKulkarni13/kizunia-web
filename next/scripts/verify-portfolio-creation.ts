/**
 * Standing regression check for Portfolio creation: the normal duplicate
 * path (`PortfolioService.create`'s existence pre-check) and the
 * concurrent-duplicate path (`PortfolioRepository.create`'s P2002 catch)
 * must both resolve to `PortfolioAlreadyExistsError` — never a raw Prisma
 * error — which the existing error architecture maps to HTTP 409.
 *
 * There is no test runner in this repository yet, so this is a standalone
 * script, following the convention in `verify-project-search.ts`. Run with:
 *
 *   pnpm exec tsx scripts/verify-portfolio-creation.ts
 */

import { randomUUID } from "node:crypto";

import { PrismaClient } from "../src/generated/prisma";
import { PlatformRole } from "../src/authorization/platform/roles";
import { portfolioService } from "../src/modules/portfolio/backend/service";
import { PortfolioRepository } from "../src/modules/portfolio/backend/repository";
import { PortfolioAlreadyExistsError } from "../src/modules/portfolio/errors";
import { HttpStatus } from "../src/lib/errors";

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

const FIXTURE_PREFIX = "__verify_portfolio_creation__";

async function seedUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: randomUUID(),
      name: `${FIXTURE_PREFIX} ${suffix}`,
      email: `${FIXTURE_PREFIX}-${suffix}@example.com`,
    },
  });
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
  const serviceUser = await seedUser("service-path");
  const repositoryUser = await seedUser("repository-path");

  try {
    console.log("\n== Invariant: an eligible user can create a portfolio, and it is editor-shaped ==");

    const actor = {
      id: serviceUser.id,
      role: PlatformRole.USER,
      banned: false,
    };

    const created = await portfolioService.create({ actor });

    report(
      "the created portfolio is returned with the editor shape (has user.name)",
      typeof created.user.name === "string",
    );

    console.log("\n== Invariant: a normal duplicate create maps to PortfolioAlreadyExistsError -> 409 ==");

    let normalDuplicateError: unknown = null;

    try {
      await portfolioService.create({ actor });
    } catch (error) {
      normalDuplicateError = error;
    }

    report(
      "the second create (same actor) throws PortfolioAlreadyExistsError",
      normalDuplicateError instanceof PortfolioAlreadyExistsError,
    );
    report(
      "the error maps to HTTP 409",
      normalDuplicateError instanceof PortfolioAlreadyExistsError &&
        normalDuplicateError.status === HttpStatus.CONFLICT,
    );

    console.log("\n== Invariant: a concurrent duplicate (bypassing the pre-check) also maps to PortfolioAlreadyExistsError -> 409 ==");

    // Exercises the repository's P2002 backstop deterministically, without
    // needing true DB concurrency: call the repository directly twice for
    // the same userId, bypassing PortfolioService's existence pre-check.
    await repository.create({
      data: {
        displayName: `${FIXTURE_PREFIX} repository-path`,
        user: { connect: { id: repositoryUser.id } },
      },
    });

    let raceError: unknown = null;

    try {
      await repository.create({
        data: {
          displayName: `${FIXTURE_PREFIX} repository-path`,
          user: { connect: { id: repositoryUser.id } },
        },
      });
    } catch (error) {
      raceError = error;
    }

    report(
      "the second raw repository.create for the same userId throws PortfolioAlreadyExistsError, not a raw Prisma error",
      raceError instanceof PortfolioAlreadyExistsError,
      raceError instanceof Error ? `got ${raceError.constructor.name}` : String(raceError),
    );
    report(
      "that error also maps to HTTP 409",
      raceError instanceof PortfolioAlreadyExistsError &&
        raceError.status === HttpStatus.CONFLICT,
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
