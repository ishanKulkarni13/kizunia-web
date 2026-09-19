/**
 * Verifies `CompetitionEligibilityRepository`/`CompetitionEligibilityService`
 * against a real database: attach, detach, idempotency, the not-found case,
 * and that an empty relation is distinct from an explicit `OPEN` row.
 *
 * Requires a reachable test database — see docs/testing/database.md.
 */
import { afterAll, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { EligibilityType } from "@/generated/prisma";
import { CompetitionEligibilityService } from "./competition-eligibility.service";
import { CompetitionEligibilityNotFoundError } from "../errors";

const TEST_SLUG_PREFIX = "__vitest_eligibility_test__";

function testSlug(name: string): string {
  return `${TEST_SLUG_PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function createTestCompetition(slugSuffix: string) {
  return prisma.competition.create({
    data: {
      title: "Eligibility Contract Test Competition",
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

describe("CompetitionEligibilityService", () => {
  it("starts with an empty list — an absent relation, not an implicit OPEN", async () => {
    const competition = await createTestCompetition("empty");

    const eligibilities = await CompetitionEligibilityService.list(
      competition.id,
    );

    expect(eligibilities).toEqual([]);
  });

  it("attaches a value and it shows up in the list", async () => {
    const competition = await createTestCompetition("attach");

    const eligibilities = await CompetitionEligibilityService.attach(
      competition.id,
      EligibilityType.UNDERGRADUATE,
    );

    expect(eligibilities).toEqual([{ type: EligibilityType.UNDERGRADUATE }]);
  });

  it("attaching the same value twice is idempotent", async () => {
    const competition = await createTestCompetition("idempotent");

    await CompetitionEligibilityService.attach(
      competition.id,
      EligibilityType.OPEN,
    );

    const eligibilities = await CompetitionEligibilityService.attach(
      competition.id,
      EligibilityType.OPEN,
    );

    expect(eligibilities).toEqual([{ type: EligibilityType.OPEN }]);
  });

  it("supports a full set: add several, remove one, leaving the rest", async () => {
    const competition = await createTestCompetition("set");

    await CompetitionEligibilityService.attach(
      competition.id,
      EligibilityType.UNDERGRADUATE,
    );
    await CompetitionEligibilityService.attach(
      competition.id,
      EligibilityType.POSTGRADUATE,
    );
    await CompetitionEligibilityService.attach(
      competition.id,
      EligibilityType.PHD,
    );

    const afterDetach = await CompetitionEligibilityService.detach(
      competition.id,
      EligibilityType.POSTGRADUATE,
    );

    expect(afterDetach.map((e) => e.type).sort()).toEqual(
      [EligibilityType.UNDERGRADUATE, EligibilityType.PHD].sort(),
    );
  });

  it("detaching every value clears the relation back to empty", async () => {
    const competition = await createTestCompetition("clear");

    await CompetitionEligibilityService.attach(
      competition.id,
      EligibilityType.SCHOOL,
    );

    const cleared = await CompetitionEligibilityService.detach(
      competition.id,
      EligibilityType.SCHOOL,
    );

    expect(cleared).toEqual([]);
  });

  it("detaching a value that was never attached throws not-found", async () => {
    const competition = await createTestCompetition("not-found");

    await expect(
      CompetitionEligibilityService.detach(
        competition.id,
        EligibilityType.LAW,
      ),
    ).rejects.toBeInstanceOf(CompetitionEligibilityNotFoundError);
  });

  it("replacing the set is attach-the-new plus detach-the-old, leaving exactly the new set", async () => {
    const competition = await createTestCompetition("replace");

    await CompetitionEligibilityService.attach(
      competition.id,
      EligibilityType.PROFESSIONAL,
    );

    await CompetitionEligibilityService.attach(
      competition.id,
      EligibilityType.OPEN,
    );

    const afterReplace = await CompetitionEligibilityService.detach(
      competition.id,
      EligibilityType.PROFESSIONAL,
    );

    expect(afterReplace).toEqual([{ type: EligibilityType.OPEN }]);
  });
});
