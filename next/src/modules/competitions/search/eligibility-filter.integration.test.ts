/**
 * Domain semantics for the eligibility discovery filter, verified against a
 * real database through the actual public search path
 * (`CompetitionService.search`):
 *
 *   - an absent eligibility relation ([]) is not "open to everyone" and does
 *     not match any eligibility-specific filter, including "Open for All";
 *   - `OPEN` is a wildcard: a competition declaring it matches every
 *     eligibility-specific filter, alone or alongside other values;
 *   - "Open for All" (the `eligibilities=OPEN` filter) matches only a
 *     competition that explicitly declares `OPEN` — never an empty relation;
 *   - multi-select stays OR across the requested values, with `OPEN` added
 *     as coverage rather than replacing the request.
 *
 * Requires a reachable test database — see docs/testing/database.md.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { EligibilityType } from "@/generated/prisma";
import { CompetitionService } from "../backend/service";

const TEST_SLUG_PREFIX = "__vitest_eligibility_filter_test__";

function testSlug(name: string): string {
  return `${TEST_SLUG_PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function createPublicCompetition(
  slugSuffix: string,
  eligibilities: EligibilityType[],
) {
  return prisma.competition.create({
    data: {
      title: `Eligibility Filter Test — ${slugSuffix}`,
      slug: testSlug(slugSuffix),
      visibility: "PUBLIC",
      eligibilities: {
        create: eligibilities.map((type) => ({ type })),
      },
    },
  });
}

describe("Eligibility discovery filter — OPEN wildcard semantics", () => {
  let empty: Awaited<ReturnType<typeof createPublicCompetition>>;
  let ug: Awaited<ReturnType<typeof createPublicCompetition>>;
  let pg: Awaited<ReturnType<typeof createPublicCompetition>>;
  let open: Awaited<ReturnType<typeof createPublicCompetition>>;
  let openPlusPg: Awaited<ReturnType<typeof createPublicCompetition>>;

  beforeAll(async () => {
    [empty, ug, pg, open, openPlusPg] = await Promise.all([
      createPublicCompetition("empty", []),
      createPublicCompetition("ug", [EligibilityType.UNDERGRADUATE]),
      createPublicCompetition("pg", [EligibilityType.POSTGRADUATE]),
      createPublicCompetition("open", [EligibilityType.OPEN]),
      createPublicCompetition("open-plus-pg", [
        EligibilityType.OPEN,
        EligibilityType.POSTGRADUATE,
      ]),
    ]);
  });

  afterAll(async () => {
    await prisma.competition.deleteMany({
      where: { slug: { startsWith: TEST_SLUG_PREFIX } },
    });
    await prisma.$disconnect();
  });

  const slugsMatching = async (eligibilities: string): Promise<Set<string>> => {
    const result = await CompetitionService.search({
      eligibilities,
      // Bounds the scan to the fixtures this file created — the shared test
      // database may hold other PUBLIC competitions with real eligibility
      // values, and this keeps assertions about presence/absence honest
      // without depending on being the only writer.
      search: "Eligibility Filter Test",
      limit: "50",
    });

    return new Set(result.items.map((item) => item.slug));
  };

  it("[] does not match a search for UNDERGRADUATE", async () => {
    const slugs = await slugsMatching(EligibilityType.UNDERGRADUATE);
    expect(slugs.has(empty.slug)).toBe(false);
  });

  it("[UNDERGRADUATE] matches a search for UNDERGRADUATE", async () => {
    const slugs = await slugsMatching(EligibilityType.UNDERGRADUATE);
    expect(slugs.has(ug.slug)).toBe(true);
  });

  it("[POSTGRADUATE] does not match a search for UNDERGRADUATE", async () => {
    const slugs = await slugsMatching(EligibilityType.UNDERGRADUATE);
    expect(slugs.has(pg.slug)).toBe(false);
  });

  it("[OPEN] matches a search for UNDERGRADUATE (wildcard)", async () => {
    const slugs = await slugsMatching(EligibilityType.UNDERGRADUATE);
    expect(slugs.has(open.slug)).toBe(true);
  });

  it("[OPEN] matches a search for POSTGRADUATE (wildcard)", async () => {
    const slugs = await slugsMatching(EligibilityType.POSTGRADUATE);
    expect(slugs.has(open.slug)).toBe(true);
  });

  it("[OPEN, POSTGRADUATE] matches a search for UNDERGRADUATE (wildcard covers a value it does not itself hold)", async () => {
    const slugs = await slugsMatching(EligibilityType.UNDERGRADUATE);
    expect(slugs.has(openPlusPg.slug)).toBe(true);
  });

  it("[OPEN, POSTGRADUATE] matches a search for POSTGRADUATE (its own explicit value)", async () => {
    const slugs = await slugsMatching(EligibilityType.POSTGRADUATE);
    expect(slugs.has(openPlusPg.slug)).toBe(true);
  });

  it("multi-select OR: UNDERGRADUATE or POSTGRADUATE matches both, and still not the empty relation", async () => {
    const slugs = await slugsMatching(
      `${EligibilityType.UNDERGRADUATE},${EligibilityType.POSTGRADUATE}`,
    );

    expect(slugs.has(ug.slug)).toBe(true);
    expect(slugs.has(pg.slug)).toBe(true);
    expect(slugs.has(open.slug)).toBe(true);
    expect(slugs.has(openPlusPg.slug)).toBe(true);
    expect(slugs.has(empty.slug)).toBe(false);
  });

  describe("\"Open for All\" (eligibilities=OPEN)", () => {
    it("matches a competition that explicitly declares OPEN", async () => {
      const slugs = await slugsMatching(EligibilityType.OPEN);
      expect(slugs.has(open.slug)).toBe(true);
    });

    it("matches a competition declaring OPEN alongside other values", async () => {
      const slugs = await slugsMatching(EligibilityType.OPEN);
      expect(slugs.has(openPlusPg.slug)).toBe(true);
    });

    it("does not match an empty relation", async () => {
      const slugs = await slugsMatching(EligibilityType.OPEN);
      expect(slugs.has(empty.slug)).toBe(false);
    });

    it("does not match a competition with an unrelated explicit value", async () => {
      const slugs = await slugsMatching(EligibilityType.OPEN);
      expect(slugs.has(ug.slug)).toBe(false);
      expect(slugs.has(pg.slug)).toBe(false);
    });
  });
});
