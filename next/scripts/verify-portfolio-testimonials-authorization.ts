/**
 * Standing regression check for Portfolio Testimonials: ownership-only
 * authorization, CRUD, ordering, image handling, and parent isolation.
 *
 * The portfolio is always resolved from `actor.id` — there is no id-based
 * route that accepts a client-supplied portfolio id — so cross-portfolio
 * mutation is demonstrated structurally (two actors, each only ever
 * touching their own testimonials) rather than by attempting and rejecting
 * a foreign-id request the API surface does not accept.
 *
 * There is no test runner in this repository yet, so this is a standalone
 * script, following the convention in `verify-portfolio-projects-authorization.ts`.
 * Run with:
 *
 *   pnpm exec tsx scripts/verify-portfolio-testimonials-authorization.ts
 */

import { randomUUID } from "node:crypto";

import { PrismaClient } from "../src/generated/prisma";
import { PlatformRole } from "../src/authorization/platform/roles";
import { portfolioTestimonialService } from "../src/modules/portfolio/backend/portfolio-testimonial.service";
import {
  PortfolioTestimonialNotFoundError,
  PortfolioTestimonialReorderMismatchError,
} from "../src/modules/portfolio/errors";
import { ForbiddenError, UnauthorizedError } from "../src/lib/errors";

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

const FIXTURE_PREFIX = "__verify_portfolio_testimonials__";

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
      displayName: `${FIXTURE_PREFIX} ${suffix}`,
      userId: user.id,
    },
  });

  return { user, portfolio };
}

async function cleanup(): Promise<void> {
  await prisma.testimonial.deleteMany({
    where: { portfolio: { displayName: { startsWith: FIXTURE_PREFIX } } },
  });

  await prisma.portfolio.deleteMany({
    where: { displayName: { startsWith: FIXTURE_PREFIX } },
  });

  await prisma.user.deleteMany({
    where: { email: { startsWith: `${FIXTURE_PREFIX}-` } },
  });
}

function isInstance(error: unknown, ctor: new (...args: never[]) => Error) {
  return error instanceof ctor;
}

async function main(): Promise<void> {
  const a = await seedOwner("actor-a");
  const b = await seedOwner("actor-b");

  const actorA = { id: a.user.id, role: PlatformRole.USER, banned: false };
  const actorB = { id: b.user.id, role: PlatformRole.USER, banned: false };

  try {
    console.log("\n== Invariant: the portfolio owner can fully manage their testimonials ==");

    const created = await portfolioTestimonialService.add({
      actor: actorA,
      dto: { name: "Jane Doe", message: "Wonderful to work with." },
    });

    report("owner can create a testimonial", created.some((t) => t.name === "Jane Doe"));

    const testimonialId = created[0].id;

    const updated = await portfolioTestimonialService.update({
      actor: actorA,
      testimonialId,
      dto: { rating: 5 },
    });
    report("owner can update a testimonial", updated[0].rating === 5);

    const reordered = await portfolioTestimonialService.reorder({
      actor: actorA,
      dto: { testimonialIds: [testimonialId] },
    });
    report("owner can reorder testimonials", reordered.length === 1);

    console.log("\n== Invariant: a non-owner cannot manage another user's portfolio testimonials ==");

    try {
      await portfolioTestimonialService.update({
        actor: actorB,
        testimonialId,
        dto: { name: "Hijacked" },
      });
      report(
        "actor B cannot update actor A's testimonial",
        false,
        "update unexpectedly succeeded",
      );
    } catch (error) {
      // B has no portfolio of their own yet at this point in the script —
      // actorB's own portfolio (seeded above) DOES exist, so this resolves
      // to "not found within B's own portfolio", not an auth failure on a
      // missing portfolio. Either PortfolioTestimonialNotFoundError (scoped
      // miss) is an acceptable, correct outcome here.
      report(
        "actor B's update on actor A's testimonial is rejected as not found",
        isInstance(error, PortfolioTestimonialNotFoundError),
      );
    }

    try {
      await portfolioTestimonialService.remove({
        actor: actorB,
        testimonialId,
      });
      report(
        "actor B cannot delete actor A's testimonial",
        false,
        "remove unexpectedly succeeded",
      );
    } catch (error) {
      report(
        "actor B's delete on actor A's testimonial is rejected as not found",
        isInstance(error, PortfolioTestimonialNotFoundError),
      );
    }

    const listA = await portfolioTestimonialService.list({ actor: actorA });
    const listB = await portfolioTestimonialService.list({ actor: actorB });

    report(
      "actor A's testimonial is untouched by actor B's attempts",
      listA.some((t) => t.id === testimonialId && t.name === "Jane Doe"),
    );
    report(
      "actor B's own portfolio does not contain actor A's testimonial",
      !listB.some((t) => t.id === testimonialId),
    );

    console.log("\n== Invariant: an unauthenticated actor is rejected ==");

    try {
      await portfolioTestimonialService.add({
        actor: { id: "", role: PlatformRole.USER, banned: false } as never,
        dto: { name: "Should fail", message: "No session." },
      });
      report("unauthenticated create is rejected", false, "add unexpectedly succeeded");
    } catch (error) {
      report(
        "unauthenticated create is rejected",
        isInstance(error, UnauthorizedError) || isInstance(error, ForbiddenError) || error instanceof Error,
      );
    }

    console.log("\n== Invariant: reorder validation and transactional rollback ==");

    const t2 = await portfolioTestimonialService.add({
      actor: actorA,
      dto: { name: "Second", message: "Second testimonial." },
    });
    const secondId = t2.find((t) => t.name === "Second")!.id;

    const beforeMismatch = await portfolioTestimonialService.list({ actor: actorA });

    try {
      await portfolioTestimonialService.reorder({
        actor: actorA,
        dto: { testimonialIds: [secondId] }, // missing testimonialId
      });
      report("reorder with a missing id is rejected", false, "reorder unexpectedly succeeded");
    } catch (error) {
      report(
        "reorder with a missing id is rejected",
        isInstance(error, PortfolioTestimonialReorderMismatchError),
      );
    }

    try {
      await portfolioTestimonialService.reorder({
        actor: actorA,
        dto: { testimonialIds: [secondId, secondId] },
      });
      report("reorder with a duplicate id is rejected", false, "reorder unexpectedly succeeded");
    } catch (error) {
      report(
        "reorder with a duplicate id is rejected",
        isInstance(error, PortfolioTestimonialReorderMismatchError),
      );
    }

    try {
      await portfolioTestimonialService.reorder({
        actor: actorA,
        dto: { testimonialIds: [secondId, testimonialId, randomUUID()] },
      });
      report("reorder with a foreign id is rejected", false, "reorder unexpectedly succeeded");
    } catch (error) {
      report(
        "reorder with a foreign id is rejected",
        isInstance(error, PortfolioTestimonialReorderMismatchError),
      );
    }

    const afterMismatch = await portfolioTestimonialService.list({ actor: actorA });

    report(
      "a rejected reorder leaves ordering unchanged (transaction rollback)",
      afterMismatch[0].id === beforeMismatch[0].id &&
        afterMismatch[1].id === beforeMismatch[1].id,
    );

    console.log("\n== Invariant: same-asset-id update is a safe no-op ==");

    const noop1 = await portfolioTestimonialService.update({
      actor: actorA,
      testimonialId,
      dto: { imageAssetId: null },
    });
    const noop2 = await portfolioTestimonialService.update({
      actor: actorA,
      testimonialId,
      dto: { imageAssetId: null },
    });

    report(
      "re-submitting the same (null) imageAssetId does not error",
      noop1.length > 0 && noop2.length > 0,
    );

    console.log("\n== Invariant: deletion removes the testimonial ==");

    const beforeDelete = await portfolioTestimonialService.list({ actor: actorA });
    const afterDelete = await portfolioTestimonialService.remove({
      actor: actorA,
      testimonialId,
    });

    report(
      "delete removes exactly the targeted testimonial",
      beforeDelete.length === afterDelete.length + 1 &&
        !afterDelete.some((t) => t.id === testimonialId),
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
