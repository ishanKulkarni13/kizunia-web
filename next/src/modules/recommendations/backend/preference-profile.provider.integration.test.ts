/**
 * Confirms the DB-backed adapter side of the `PreferenceProfileProvider`
 * port: persisted `CompetitionPreference` rows reconstruct into exactly the
 * flat `PreferenceEntry[]` shape the engine expects
 * (`normalizeProfile`/`runRecommendationPipeline`), with no engine code
 * involved here — the point of the port is that the engine never needs to
 * know how a profile was stored.
 *
 * Requires a reachable test database — see docs/testing/database.md.
 */
import { afterAll, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { CompetitionPreferenceRepository } from "@/modules/preferences/backend/competition-preference.repository";
import { DimensionId, normalizeProfile } from "../engine";

import { DbPreferenceProfileProvider } from "./preference-profile.provider";

const PREFIX = "__vitest_preference_profile_provider_test__";

function unique(name: string): string {
  return `${PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function createTestUser(nameSuffix: string) {
  return prisma.user.create({
    data: {
      id: unique(`user-${nameSuffix}`),
      name: "Preference Profile Provider Test User",
      email: `${unique(`user-${nameSuffix}`)}@example.test`,
      emailVerified: true,
    },
  });
}

afterAll(async () => {
  await prisma.competitionPreference.deleteMany({
    where: { user: { email: { startsWith: PREFIX } } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

describe("DbPreferenceProfileProvider", () => {
  it("returns an empty profile for a user with no persisted preferences", async () => {
    const user = await createTestUser("empty");
    const provider = new DbPreferenceProfileProvider();

    const profile = await provider.load(user.id);

    expect(profile).toEqual([]);
  });

  it("reconstructs persisted rows into PreferenceEntry[], consumable by normalizeProfile unmodified", async () => {
    const user = await createTestUser("reconstruct");

    await CompetitionPreferenceRepository.replaceForUser(user.id, [
      { dimension: "mode", value: "ONLINE", weight: 0.5 },
      { dimension: "registrationFeeType", value: "FREE", weight: 1 },
    ]);

    const provider = new DbPreferenceProfileProvider();
    const profile = await provider.load(user.id);

    expect(profile).toEqual(
      expect.arrayContaining([
        { dimension: DimensionId.MODE, value: "ONLINE", weight: 0.5 },
        { dimension: DimensionId.REGISTRATION_FEE_TYPE, value: "FREE", weight: 1 },
      ]),
    );

    // The engine's own normalization must accept this shape with zero
    // knowledge of where it came from.
    const normalized = normalizeProfile(profile);
    expect(normalized.get(DimensionId.REGISTRATION_FEE_TYPE)?.hard).toBe(true);
  });

  it("user isolation: one user's profile never leaks into another's", async () => {
    const userA = await createTestUser("isolation-a");
    const userB = await createTestUser("isolation-b");

    await CompetitionPreferenceRepository.replaceForUser(userA.id, [
      { dimension: "mode", value: "ONLINE", weight: 0.5 },
    ]);

    const provider = new DbPreferenceProfileProvider();
    const profileA = await provider.load(userA.id);
    const profileB = await provider.load(userB.id);

    expect(profileA).toHaveLength(1);
    expect(profileB).toEqual([]);
  });
});
