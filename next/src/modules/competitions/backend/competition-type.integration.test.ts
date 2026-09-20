/**
 * Verifies `CompetitionTypeRepository`/`CompetitionTypeService` against a
 * real database: attach, detach, idempotency, the not-found case, and that
 * an empty relation is a valid, distinct state (unclassified, not excluded).
 *
 * Requires a reachable test database -- see docs/testing/database.md.
 */
import { afterAll, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { CompetitionType } from "@/generated/prisma";
import { CompetitionTypeService } from "./competition-type.service";
import { CompetitionTypeNotFoundError } from "../errors";

const TEST_SLUG_PREFIX = "__vitest_type_test__";

function testSlug(name: string): string {
  return `${TEST_SLUG_PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function createTestCompetition(slugSuffix: string) {
  return prisma.competition.create({
    data: {
      title: "Type Contract Test Competition",
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

describe("CompetitionTypeService", () => {
  it("starts with an empty list -- zero types is a valid, intentional state", async () => {
    const competition = await createTestCompetition("empty");

    const types = await CompetitionTypeService.list(competition.id);

    expect(types).toEqual([]);
  });

  it("attaches a value and it shows up in the list", async () => {
    const competition = await createTestCompetition("attach");

    const types = await CompetitionTypeService.attach(
      competition.id,
      CompetitionType.HACKATHON,
    );

    expect(types).toEqual([{ type: CompetitionType.HACKATHON }]);
  });

  it("attaching the same value twice is idempotent", async () => {
    const competition = await createTestCompetition("idempotent");

    await CompetitionTypeService.attach(
      competition.id,
      CompetitionType.CTF,
    );

    const types = await CompetitionTypeService.attach(
      competition.id,
      CompetitionType.CTF,
    );

    expect(types).toEqual([{ type: CompetitionType.CTF }]);
  });

  it("supports attaching multiple types", async () => {
    const competition = await createTestCompetition("multi");

    await CompetitionTypeService.attach(
      competition.id,
      CompetitionType.HACKATHON,
    );
    await CompetitionTypeService.attach(
      competition.id,
      CompetitionType.IDEATHON,
    );
    await CompetitionTypeService.attach(
      competition.id,
      CompetitionType.QUIZ,
    );

    const types = await CompetitionTypeService.list(competition.id);

    expect(types.map((t) => t.type).sort()).toEqual(
      [
        CompetitionType.HACKATHON,
        CompetitionType.IDEATHON,
        CompetitionType.QUIZ,
      ].sort(),
    );
  });

  it("supports a full set: add several, remove one, leaving the rest", async () => {
    const competition = await createTestCompetition("set");

    await CompetitionTypeService.attach(
      competition.id,
      CompetitionType.HACKATHON,
    );
    await CompetitionTypeService.attach(
      competition.id,
      CompetitionType.CTF,
    );
    await CompetitionTypeService.attach(
      competition.id,
      CompetitionType.DSA,
    );

    const afterDetach = await CompetitionTypeService.detach(
      competition.id,
      CompetitionType.CTF,
    );

    expect(afterDetach.map((t) => t.type).sort()).toEqual(
      [CompetitionType.HACKATHON, CompetitionType.DSA].sort(),
    );
  });

  it("detaching every value clears the relation back to empty", async () => {
    const competition = await createTestCompetition("clear");

    await CompetitionTypeService.attach(
      competition.id,
      CompetitionType.GAMING,
    );

    const cleared = await CompetitionTypeService.detach(
      competition.id,
      CompetitionType.GAMING,
    );

    expect(cleared).toEqual([]);
  });

  it("detaching a value that was never attached throws not-found", async () => {
    const competition = await createTestCompetition("not-found");

    await expect(
      CompetitionTypeService.detach(
        competition.id,
        CompetitionType.ROBOTICS,
      ),
    ).rejects.toBeInstanceOf(CompetitionTypeNotFoundError);
  });

  it("replacing the set is attach-the-new plus detach-the-old, leaving exactly the new set", async () => {
    const competition = await createTestCompetition("replace");

    await CompetitionTypeService.attach(
      competition.id,
      CompetitionType.BUSINESS_PLAN,
    );
    await CompetitionTypeService.attach(
      competition.id,
      CompetitionType.PITCHING,
    );

    // Remove BUSINESS_PLAN, keep PITCHING
    const afterReplace = await CompetitionTypeService.detach(
      competition.id,
      CompetitionType.BUSINESS_PLAN,
    );

    expect(afterReplace).toEqual([{ type: CompetitionType.PITCHING }]);
  });
});
