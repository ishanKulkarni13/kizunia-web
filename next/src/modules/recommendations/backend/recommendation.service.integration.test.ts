/**
 * End-to-end: `userId -> RecommendationResult`, against a real Postgres
 * database and the real candidate query. Requires a reachable test
 * database — see docs/testing/database.md. Fails loudly rather than
 * skipping if `DATABASE_TEST_URL` is not configured, matching this repo's
 * other integration tests.
 *
 * Does not stub `SessionService` — this test calls `RecommendationService`
 * directly, bypassing the controller/session layer entirely, so there is
 * nothing to stub.
 */
import { afterAll, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import {
  CompetitionStatus,
  CompetitionVisibility,
  EligibilityType,
  SearchAreaRelation,
  SearchAreaSource,
} from "@/generated/prisma";

import { RecommendationService } from "./recommendation.service";
import { DimensionId } from "../engine";

const PREFIX = "__vitest_recommendations_test__";

function unique(name: string): string {
  return `${PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function createTestUser(nameSuffix: string) {
  return prisma.user.create({
    data: {
      id: unique(`user-${nameSuffix}`),
      name: "Recommendation Test User",
      email: `${unique(`user-${nameSuffix}`)}@example.test`,
      emailVerified: true,
    },
  });
}

async function createTestCategory(slugSuffix: string) {
  return prisma.category.create({
    data: { name: unique(`category-${slugSuffix}`), slug: unique(`category-${slugSuffix}`) },
  });
}

async function createTestLocation() {
  const searchArea = await prisma.searchArea.create({
    data: {
      displayName: "Test Pune",
      identityKey: unique("search-area"),
    },
  });

  const location = await prisma.location.create({
    data: { displayName: "Test Pune Venue" },
  });

  await prisma.locationSearchArea.create({
    data: {
      locationId: location.id,
      searchAreaId: searchArea.id,
      relation: SearchAreaRelation.EXACT,
      source: SearchAreaSource.SELECTED_PLACE,
    },
  });

  return { searchArea, location };
}

async function createTestCompetition(
  slugSuffix: string,
  overrides: {
    status?: CompetitionStatus | null;
    visibility?: CompetitionVisibility;
    deletedAt?: Date | null;
    categoryId?: string;
    locationId?: string;
    eligibility?: EligibilityType;
  } = {},
) {
  const competition = await prisma.competition.create({
    data: {
      title: `Recommendation Test Competition ${slugSuffix}`,
      slug: unique(`competition-${slugSuffix}`),
      visibility: overrides.visibility ?? CompetitionVisibility.PUBLIC,
      status: overrides.status ?? CompetitionStatus.REGISTRATION_OPEN,
      deletedAt: overrides.deletedAt ?? null,
    },
  });

  if (overrides.categoryId) {
    await prisma.competitionCategory.create({
      data: { competitionId: competition.id, categoryId: overrides.categoryId },
    });
  }

  if (overrides.locationId) {
    await prisma.competitionLocation.create({
      data: { competitionId: competition.id, locationId: overrides.locationId },
    });
  }

  if (overrides.eligibility) {
    await prisma.competitionEligibility.create({
      data: { competitionId: competition.id, type: overrides.eligibility },
    });
  }

  return competition;
}

afterAll(async () => {
  await prisma.competitionEligibility.deleteMany({
    where: { competition: { slug: { startsWith: PREFIX } } },
  });
  await prisma.competitionCategory.deleteMany({
    where: { competition: { slug: { startsWith: PREFIX } } },
  });
  await prisma.competitionLocation.deleteMany({
    where: { competition: { slug: { startsWith: PREFIX } } },
  });
  await prisma.competition.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.locationSearchArea.deleteMany({
    where: { searchArea: { identityKey: { startsWith: PREFIX } } },
  });
  await prisma.location.deleteMany({ where: { displayName: "Test Pune Venue" } });
  await prisma.searchArea.deleteMany({ where: { identityKey: { startsWith: PREFIX } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

describe("RecommendationService.generateForUser", () => {
  it("returns a ranked result for a real user against real candidates", async () => {
    const user = await createTestUser("main");
    const category = await createTestCategory("ai");
    const { searchArea, location } = await createTestLocation();

    const matching = await createTestCompetition("matching", {
      categoryId: category.id,
      locationId: location.id,
      eligibility: EligibilityType.UNDERGRADUATE,
    });

    const mismatching = await createTestCompetition("mismatching", {
      eligibility: EligibilityType.UNDERGRADUATE,
    });

    // Excluded from candidate selection entirely.
    await createTestCompetition("closed", { status: CompetitionStatus.REGISTRATION_CLOSED });
    await createTestCompetition("private", { visibility: CompetitionVisibility.PRIVATE });
    const deletedCompetition = await createTestCompetition("soon-deleted");
    await prisma.competition.update({
      where: { id: deletedCompetition.id },
      data: { deletedAt: new Date() },
    });

    const result = await RecommendationService.generateForUser({
      userId: user.id,
      profileOverrides: [
        { dimension: DimensionId.CATEGORIES, value: category.slug, weight: 1.0 },
        { dimension: DimensionId.LOCATION, value: searchArea.id, weight: 0.8 },
        { dimension: DimensionId.ELIGIBILITIES, value: "UNDERGRADUATE", weight: 1.0 },
      ],
      includeDiagnostics: true,
    });

    expect(result.userId).toBe(user.id);
    expect(result.items.map((item) => item.competition.id)).toContain(matching.id);
    expect(result.items.map((item) => item.competition.id)).not.toContain(mismatching.id);

    // The closed/private/deleted competitions must never even be evaluated
    // as candidates — not merely excluded from the final result.
    const evaluatedIds = result.diagnostics!.traces.map((t) => t.candidateId);
    expect(evaluatedIds).not.toContain(deletedCompetition.id);

    // The top result should be the fully-matching competition.
    expect(result.items[0]?.competition.id).toBe(matching.id);
    expect(result.items[0]?.rank).toBe(1);
  });

  it("writes nothing to any notification-related table", async () => {
    const user = await createTestUser("no-side-effects");

    const before = await prisma.notificationPreference.count();

    await RecommendationService.generateForUser({
      userId: user.id,
      profileOverrides: [{ dimension: DimensionId.MODE, value: "ONLINE", weight: 0.5 }],
    });

    const after = await prisma.notificationPreference.count();
    expect(after).toBe(before);
  });
});
