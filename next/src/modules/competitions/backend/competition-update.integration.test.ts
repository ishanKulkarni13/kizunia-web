/**
 * Broader undefined/null/diff contract for `CompetitionRepository.update`,
 * complementing `competition-content.integration.test.ts` (which covers
 * only `content`). Verifies the core product principle end to end: a
 * competition with every optional field null can still be saved and can
 * still be flipped to PUBLIC — there is no publish validator anywhere in
 * this path (see the audit's "Publishing" section).
 *
 * Requires a reachable test database — see docs/testing/database.md.
 */
import { afterAll, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { CompetitionRepository } from "./repository";

const TEST_SLUG_PREFIX = "__vitest_update_test__";

function testSlug(name: string): string {
  return `${TEST_SLUG_PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function createTestCompetition(slugSuffix: string) {
  return prisma.competition.create({
    data: {
      title: "Update Contract Test Competition",
      slug: testSlug(slugSuffix),
    },
  });
}

afterAll(async () => {
  await prisma.competition.deleteMany({
    where: { slug: { startsWith: TEST_SLUG_PREFIX } },
  });
  await prisma.$disconnect();
});

describe("CompetitionRepository.update — scalar undefined/null contract", () => {
  it("an explicit null persists as SQL NULL", async () => {
    const competition = await createTestCompetition("null-scalar");

    await CompetitionRepository.update({
      id: competition.id,
      data: { registrationLink: "https://example.com/register" },
    });

    const cleared = await CompetitionRepository.update({
      id: competition.id,
      data: { registrationLink: null },
    });

    expect(cleared.registrationLink).toBeNull();
  });

  it("an omitted key leaves the existing value untouched", async () => {
    const competition = await createTestCompetition("omitted-scalar");

    await CompetitionRepository.update({
      id: competition.id,
      data: { organizer: "Kizunia Foundation" },
    });

    const afterUnrelatedUpdate = await CompetitionRepository.update({
      id: competition.id,
      data: { website: "https://example.com" },
    });

    expect(afterUnrelatedUpdate.organizer).toBe("Kizunia Foundation");
  });

  it("saves and publishes a competition with every optional field null", async () => {
    // The core product principle: no separate "completeness" gate exists.
    // Mode, team size, certificate, prize, registration link, and content
    // are all null here, and the save (including flipping visibility to
    // PUBLIC) must succeed regardless.
    const competition = await createTestCompetition("all-null-optional");

    const updated = await CompetitionRepository.update({
      id: competition.id,
      data: {
        mode: null,
        minTeamSize: null,
        maxTeamSize: null,
        certificateType: null,
        prizePool: null,
        registrationLink: null,
        content: null,
        visibility: "PUBLIC",
      },
    });

    expect(updated.visibility).toBe("PUBLIC");
    expect(updated.mode).toBeNull();
    expect(updated.minTeamSize).toBeNull();
    expect(updated.certificateType).toBeNull();
  });

  it("detects a duplicate slug via existsBySlugExceptCompetition", async () => {
    const first = await createTestCompetition("dup-a");
    const second = await createTestCompetition("dup-b");

    const collidesWithFirst =
      await CompetitionRepository.existsBySlugExceptCompetition({
        slug: first.slug,
        competitionId: second.id,
      });
    expect(collidesWithFirst).toBe(true);

    const collidesWithSelf =
      await CompetitionRepository.existsBySlugExceptCompetition({
        slug: first.slug,
        competitionId: first.id,
      });
    expect(collidesWithSelf).toBe(false);
  });

  it("changing the slug via update is honored (the editor's diff now includes it)", async () => {
    const competition = await createTestCompetition("slug-change");
    const newSlug = testSlug("renamed");

    const updated = await CompetitionRepository.update({
      id: competition.id,
      data: { slug: newSlug },
    });

    expect(updated.slug).toBe(newSlug);
  });
});
