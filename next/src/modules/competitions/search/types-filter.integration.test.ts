/**
 * Domain semantics for the Competition Type discovery filter, verified
 * against a real database through the actual public search path
 * (`CompetitionService.search`):
 *
 *   - an absent type relation ([]) does not match any type-specific filter —
 *     unlike eligibility, there is no wildcard value a competition can
 *     declare to opt into every type query;
 *   - multi-select stays OR across the requested values (HACKATHON + CTF
 *     means HACKATHON or CTF);
 *   - `OTHER` behaves as an ordinary value: it matches only competitions
 *     that declare it, and never leaks into a query for other values;
 *   - the type filter composes as AND with another filter dimension rather
 *     than replacing it.
 *
 * Requires a reachable test database — see docs/testing/database.md.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { CompetitionType, OrganizerType } from "@/generated/prisma";
import { CompetitionService } from "../backend/service";

const TEST_SLUG_PREFIX = "__vitest_types_filter_test__";

function testSlug(name: string): string {
  return `${TEST_SLUG_PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function createPublicCompetition(
  slugSuffix: string,
  types: CompetitionType[],
  organizerType?: OrganizerType,
) {
  return prisma.competition.create({
    data: {
      title: `Types Filter Test — ${slugSuffix}`,
      slug: testSlug(slugSuffix),
      visibility: "PUBLIC",
      organizerType,
      types: {
        create: types.map((type) => ({ type })),
      },
    },
  });
}

describe("Competition Type discovery filter — no-wildcard OR semantics", () => {
  let empty: Awaited<ReturnType<typeof createPublicCompetition>>;
  let hackathon: Awaited<ReturnType<typeof createPublicCompetition>>;
  let ctf: Awaited<ReturnType<typeof createPublicCompetition>>;
  let other: Awaited<ReturnType<typeof createPublicCompetition>>;
  let hackathonCollege: Awaited<ReturnType<typeof createPublicCompetition>>;

  beforeAll(async () => {
    [empty, hackathon, ctf, other, hackathonCollege] = await Promise.all([
      createPublicCompetition("empty", []),
      createPublicCompetition("hackathon", [CompetitionType.HACKATHON]),
      createPublicCompetition("ctf", [CompetitionType.CTF]),
      createPublicCompetition("other", [CompetitionType.OTHER]),
      createPublicCompetition(
        "hackathon-college",
        [CompetitionType.HACKATHON],
        OrganizerType.COLLEGE,
      ),
    ]);
  });

  afterAll(async () => {
    await prisma.competition.deleteMany({
      where: { slug: { startsWith: TEST_SLUG_PREFIX } },
    });
    await prisma.$disconnect();
  });

  const slugsMatching = async (
    params: Record<string, string>,
  ): Promise<Set<string>> => {
    const result = await CompetitionService.search({
      ...params,
      // Bounds the scan to the fixtures this file created — the shared test
      // database may hold other PUBLIC competitions with real type values,
      // and this keeps assertions about presence/absence honest without
      // depending on being the only writer.
      search: "Types Filter Test",
      limit: "50",
    });

    return new Set(result.items.map((item) => item.slug));
  };

  it("no type filter returns every fixture, including the zero-type one", async () => {
    const slugs = await slugsMatching({});

    expect(slugs.has(empty.slug)).toBe(true);
    expect(slugs.has(hackathon.slug)).toBe(true);
    expect(slugs.has(ctf.slug)).toBe(true);
    expect(slugs.has(other.slug)).toBe(true);
    expect(slugs.has(hackathonCollege.slug)).toBe(true);
  });

  it("[] does not match a search for HACKATHON", async () => {
    const slugs = await slugsMatching({ types: CompetitionType.HACKATHON });
    expect(slugs.has(empty.slug)).toBe(false);
  });

  it("[HACKATHON] matches a search for HACKATHON", async () => {
    const slugs = await slugsMatching({ types: CompetitionType.HACKATHON });
    expect(slugs.has(hackathon.slug)).toBe(true);
  });

  it("[CTF] does not match a search for HACKATHON", async () => {
    const slugs = await slugsMatching({ types: CompetitionType.HACKATHON });
    expect(slugs.has(ctf.slug)).toBe(false);
  });

  it("multi-select OR: HACKATHON or CTF matches both, and still not the empty relation", async () => {
    const slugs = await slugsMatching({
      types: `${CompetitionType.HACKATHON},${CompetitionType.CTF}`,
    });

    expect(slugs.has(hackathon.slug)).toBe(true);
    expect(slugs.has(hackathonCollege.slug)).toBe(true);
    expect(slugs.has(ctf.slug)).toBe(true);
    expect(slugs.has(empty.slug)).toBe(false);
    expect(slugs.has(other.slug)).toBe(false);
  });

  describe("OTHER is an ordinary value, not a wildcard", () => {
    it("matches a competition that declares OTHER", async () => {
      const slugs = await slugsMatching({ types: CompetitionType.OTHER });
      expect(slugs.has(other.slug)).toBe(true);
    });

    it("does not match an empty relation", async () => {
      const slugs = await slugsMatching({ types: CompetitionType.OTHER });
      expect(slugs.has(empty.slug)).toBe(false);
    });

    it("does not match a competition with an unrelated explicit value", async () => {
      const slugs = await slugsMatching({ types: CompetitionType.OTHER });
      expect(slugs.has(hackathon.slug)).toBe(false);
      expect(slugs.has(ctf.slug)).toBe(false);
    });

    it("OTHER + HACKATHON matches a HACKATHON-only competition and an OTHER-only competition, but not CTF", async () => {
      const slugs = await slugsMatching({
        types: `${CompetitionType.OTHER},${CompetitionType.HACKATHON}`,
      });

      expect(slugs.has(hackathon.slug)).toBe(true);
      expect(slugs.has(other.slug)).toBe(true);
      expect(slugs.has(ctf.slug)).toBe(false);
      expect(slugs.has(empty.slug)).toBe(false);
    });
  });

  describe("composes as AND with another filter dimension", () => {
    it("HACKATHON + organizerType=COLLEGE matches only the fixture with both", async () => {
      const slugs = await slugsMatching({
        types: CompetitionType.HACKATHON,
        organizerTypes: OrganizerType.COLLEGE,
      });

      expect(slugs.has(hackathonCollege.slug)).toBe(true);
      expect(slugs.has(hackathon.slug)).toBe(false);
    });
  });
});
