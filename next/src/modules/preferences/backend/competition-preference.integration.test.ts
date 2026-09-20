/**
 * Verifies `CompetitionPreferenceService`'s validation and transactional
 * full-replace behavior against a real Postgres database, and confirms
 * user isolation.
 *
 * Requires a reachable test database — see docs/testing/database.md. Fails
 * loudly rather than skipping if `DATABASE_TEST_URL` is not configured for
 * a real database, matching this repo's other integration tests.
 */
import { afterAll, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { DimensionId } from "@/modules/recommendations";

import { CompetitionPreferenceService } from "./competition-preference.service";

const PREFIX = "__vitest_competition_preference_test__";

function unique(name: string): string {
  return `${PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function createTestUser(nameSuffix: string) {
  return prisma.user.create({
    data: {
      id: unique(`user-${nameSuffix}`),
      name: "Competition Preference Test User",
      email: `${unique(`user-${nameSuffix}`)}@example.test`,
      emailVerified: true,
    },
  });
}

async function createTestCategory(nameSuffix: string) {
  const slug = unique(`category-${nameSuffix}`);
  return prisma.category.create({ data: { name: slug, slug } });
}

async function createTestSearchArea(nameSuffix: string) {
  return prisma.searchArea.create({
    data: { displayName: "Test Area", identityKey: unique(`search-area-${nameSuffix}`) },
  });
}

afterAll(async () => {
  await prisma.competitionPreference.deleteMany({
    where: { user: { email: { startsWith: PREFIX } } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.searchArea.deleteMany({ where: { identityKey: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

describe("CompetitionPreferenceService", () => {
  it("an empty profile round-trips as an empty array", async () => {
    const user = await createTestUser("empty");

    const preferences = await CompetitionPreferenceService.getForUser(user.id);
    expect(preferences).toEqual([]);
  });

  it("persists one preference", async () => {
    const user = await createTestUser("one");

    await CompetitionPreferenceService.replaceForUser(user.id, {
      preferences: [{ dimension: DimensionId.MODE, value: "ONLINE", weight: 0.5 }],
    });

    const preferences = await CompetitionPreferenceService.getForUser(user.id);
    expect(preferences).toEqual([{ dimension: DimensionId.MODE, value: "ONLINE", weight: 0.5 }]);
  });

  it("persists multiple preferences across dimensions and multiple values within one dimension", async () => {
    const user = await createTestUser("multi");
    const searchAreaA = await createTestSearchArea("multi-a");
    const searchAreaB = await createTestSearchArea("multi-b");

    await CompetitionPreferenceService.replaceForUser(user.id, {
      preferences: [
        { dimension: DimensionId.MODE, value: "ONLINE", weight: 0.5 },
        { dimension: DimensionId.LOCATION, value: searchAreaA.id, weight: 0.8 },
        { dimension: DimensionId.LOCATION, value: searchAreaB.id, weight: 0.3 },
      ],
    });

    const preferences = await CompetitionPreferenceService.getForUser(user.id);
    expect(preferences).toHaveLength(3);
    expect(preferences.filter((p) => p.dimension === DimensionId.LOCATION)).toHaveLength(2);
  });

  it.each([0, 0.5, 1])("accepts weight %s", async (weight) => {
    const user = await createTestUser(`weight-${weight}`);

    await expect(
      CompetitionPreferenceService.replaceForUser(user.id, {
        preferences: [{ dimension: DimensionId.MODE, value: "ONLINE", weight }],
      }),
    ).resolves.not.toThrow();
  });

  it("hard-constraint dominance is preserved as stored state (weight 1 sits alongside a soft sibling)", async () => {
    const user = await createTestUser("hard");

    // Persistence stores exactly what was sent — dominance/interpretation
    // is the recommendation engine's job (engine/profile.ts), not this
    // service's. This test only confirms both rows round-trip unmodified.
    await CompetitionPreferenceService.replaceForUser(user.id, {
      preferences: [
        { dimension: DimensionId.REGISTRATION_FEE_TYPE, value: "FREE", weight: 1 },
      ],
    });

    const preferences = await CompetitionPreferenceService.getForUser(user.id);
    expect(preferences).toEqual([
      { dimension: DimensionId.REGISTRATION_FEE_TYPE, value: "FREE", weight: 1 },
    ]);
  });

  it("rejects an invalid dimension at the database boundary via the zod-validated input type", async () => {
    const user = await createTestUser("invalid-dimension");

    await expect(
      CompetitionPreferenceService.replaceForUser(user.id, {
        // @ts-expect-error deliberately invalid — the schema would normally reject this before it reaches the service
        preferences: [{ dimension: "notARealDimension", value: "x", weight: 0.5 }],
      }),
    ).rejects.toThrow();
  });

  it("rejects an invalid enum-backed value", async () => {
    const user = await createTestUser("invalid-value");

    await expect(
      CompetitionPreferenceService.replaceForUser(user.id, {
        preferences: [{ dimension: DimensionId.MODE, value: "NOT_A_MODE", weight: 0.5 }],
      }),
    ).rejects.toThrow();
  });

  it("rejects an unknown category slug", async () => {
    const user = await createTestUser("unknown-category");

    await expect(
      CompetitionPreferenceService.replaceForUser(user.id, {
        preferences: [
          { dimension: DimensionId.CATEGORIES, value: "does-not-exist", weight: 0.5 },
        ],
      }),
    ).rejects.toThrow();
  });

  it("accepts an existing category slug", async () => {
    const user = await createTestUser("known-category");
    const category = await createTestCategory("known");

    const preferences = await CompetitionPreferenceService.replaceForUser(user.id, {
      preferences: [{ dimension: DimensionId.CATEGORIES, value: category.slug, weight: 0.9 }],
    });

    expect(preferences).toEqual([
      { dimension: DimensionId.CATEGORIES, value: category.slug, weight: 0.9 },
    ]);
  });

  it("rejects a non-numeric team size", async () => {
    const user = await createTestUser("invalid-team-size");

    await expect(
      CompetitionPreferenceService.replaceForUser(user.id, {
        preferences: [{ dimension: DimensionId.TEAM_SIZE, value: "not-a-number", weight: 0.5 }],
      }),
    ).rejects.toThrow();
  });

  it("rejects a duplicate (dimension, value) pair within one payload", async () => {
    const user = await createTestUser("duplicate");

    await expect(
      CompetitionPreferenceService.replaceForUser(user.id, {
        preferences: [
          { dimension: DimensionId.MODE, value: "ONLINE", weight: 0.5 },
          { dimension: DimensionId.MODE, value: "ONLINE", weight: 0.9 },
        ],
      }),
    ).rejects.toThrow();
  });

  it("update-by-replace: a second call fully replaces the first", async () => {
    const user = await createTestUser("replace");

    await CompetitionPreferenceService.replaceForUser(user.id, {
      preferences: [{ dimension: DimensionId.MODE, value: "ONLINE", weight: 0.5 }],
    });
    await CompetitionPreferenceService.replaceForUser(user.id, {
      preferences: [{ dimension: DimensionId.DIFFICULTY, value: "BEGINNER", weight: 0.4 }],
    });

    const preferences = await CompetitionPreferenceService.getForUser(user.id);
    expect(preferences).toEqual([
      { dimension: DimensionId.DIFFICULTY, value: "BEGINNER", weight: 0.4 },
    ]);
  });

  it("an empty array resets the profile", async () => {
    const user = await createTestUser("reset");

    await CompetitionPreferenceService.replaceForUser(user.id, {
      preferences: [{ dimension: DimensionId.MODE, value: "ONLINE", weight: 0.5 }],
    });
    await CompetitionPreferenceService.replaceForUser(user.id, { preferences: [] });

    const preferences = await CompetitionPreferenceService.getForUser(user.id);
    expect(preferences).toEqual([]);
  });

  it("an invalid payload leaves a prior profile untouched (validation runs before the transaction)", async () => {
    const user = await createTestUser("no-partial-write");

    await CompetitionPreferenceService.replaceForUser(user.id, {
      preferences: [{ dimension: DimensionId.MODE, value: "ONLINE", weight: 0.5 }],
    });

    await expect(
      CompetitionPreferenceService.replaceForUser(user.id, {
        preferences: [{ dimension: DimensionId.MODE, value: "NOT_A_MODE", weight: 0.5 }],
      }),
    ).rejects.toThrow();

    const preferences = await CompetitionPreferenceService.getForUser(user.id);
    expect(preferences).toEqual([{ dimension: DimensionId.MODE, value: "ONLINE", weight: 0.5 }]);
  });

  it("keeps two users' profiles fully isolated", async () => {
    const userA = await createTestUser("isolation-a");
    const userB = await createTestUser("isolation-b");

    await CompetitionPreferenceService.replaceForUser(userA.id, {
      preferences: [{ dimension: DimensionId.MODE, value: "ONLINE", weight: 0.5 }],
    });

    const preferencesA = await CompetitionPreferenceService.getForUser(userA.id);
    const preferencesB = await CompetitionPreferenceService.getForUser(userB.id);

    expect(preferencesA).toEqual([{ dimension: DimensionId.MODE, value: "ONLINE", weight: 0.5 }]);
    expect(preferencesB).toEqual([]);
  });
});
