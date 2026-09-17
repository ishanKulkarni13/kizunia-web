/**
 * Recommendations — Preference Profile Provider
 *
 * =============================================================================
 * Why a port, and what sits behind it now
 * =============================================================================
 *
 * `userId -> PreferenceProfile` is the one input the engine needs that does
 * not come from the competition domain. Phase 0 shipped with no persisted
 * preference storage — `NotificationPreference` was legacy and untyped, and
 * open decision A-2 (`docs/project/feature-specification/notification/open-decisions.md`)
 * deliberately left "what backs a real preference profile" unresolved.
 * Per explicit product direction, Phase 0 also never read
 * `User.interests`/`UserCategory` as a preference source — that relation
 * was removed from the domain entirely (see the schema migration
 * `remove_user_category_interests`), not repurposed.
 *
 * A-2 is now resolved: `CompetitionPreference` (see `prisma/schema.prisma`
 * and `modules/preferences`) is the persisted profile, and
 * `DbPreferenceProfileProvider` below is the real adapter — the module's
 * `defaultProvider` (`recommendation.service.ts`) now points at it instead
 * of `DummyPreferenceProfileProvider`. `DummyPreferenceProfileProvider` and
 * `ExplicitProfileProvider` stay in this file for the internal tuning route
 * and tests that need a fixed, hand-built profile — the whole point of the
 * port is that every adapter is interchangeable and nothing outside this
 * file needs to know which one is active.
 */
import { DimensionId, type PreferenceEntry, type PreferenceProfile } from "../engine";
import { CompetitionPreferenceRepository } from "@/modules/preferences/backend/competition-preference.repository";

export interface PreferenceProfileProvider {
  load(userId: string): Promise<PreferenceProfile>;
}

/**
 * The fixed profile every user gets in Phase 0 — the same scenario used to
 * validate the engine's behavior conceptually (see `scenario.test.ts` and
 * `docs/project/feature-specification/recommendation/preferences/phase-0-dummy-profile.md`):
 * a strong interest in AI competitions run as hackathons in Pune, open only
 * to undergraduates.
 */
export const DUMMY_PROFILE: PreferenceProfile = [
  // 0.9, not 1.0: a strong soft preference for AI, deliberately kept below
  // the hard-constraint threshold so a Web-Dev-only competition still gets
  // a (lower) score instead of being excluded outright — see
  // hard-constraint dominance in `engine/profile.ts`.
    { dimension: DimensionId.MODE, value: "ONLINE", weight: 0.1 },
  // { dimension: DimensionId.CATEGORIES, value: "ai", weight: 0.9 },
  // { dimension: DimensionId.CATEGORIES, value: "web-dev", weight: 0.4 },
  // { dimension: DimensionId.TECHNOLOGIES, value: "python", weight: 0.6 },
  { dimension: DimensionId.REGISTRATION_FEE_TYPE, value: "FREE", weight: 1 },
  { dimension: DimensionId.DIFFICULTY, value: "BEGINNER", weight: 0.1 },
  // { dimension: DimensionId.ELIGIBILITIES, value: "UNDERGRADUATE", weight: 1.0 },
];

/**
 * Returns `DUMMY_PROFILE` for every `userId`, unconditionally. Intentionally
 * ignores its argument — there is no per-user branching to accidentally get
 * wrong, which is the point: this adapter exists only so the pipeline has a
 * real, non-empty profile to run against during manual testing.
 */
export class DummyPreferenceProfileProvider implements PreferenceProfileProvider {
  async load(): Promise<PreferenceProfile> {
    return DUMMY_PROFILE;
  }
}

/**
 * Used only by the internal tuning route's optional overrides, so a
 * developer can substitute a different profile without touching code.
 */
export class ExplicitProfileProvider implements PreferenceProfileProvider {
  constructor(private readonly entries: readonly PreferenceEntry[]) {}

  async load(): Promise<PreferenceProfile> {
    return this.entries;
  }
}

/**
 * The real adapter: reads the user's persisted `CompetitionPreference` rows
 * (`modules/preferences`) and reshapes them into the flat `PreferenceEntry[]`
 * the engine expects. This is the hand-off this file's module docstring
 * anticipated — see `recommendation.service.ts`'s `defaultProvider`.
 *
 * The `as DimensionId` cast is safe, not a mapping function:
 * `CompetitionPreferenceDimension`'s enum values are defined in
 * `prisma/schema.prisma` to be identical strings to `DimensionId`'s values,
 * specifically so no translation layer is needed here.
 */
export class DbPreferenceProfileProvider implements PreferenceProfileProvider {
  async load(userId: string): Promise<PreferenceProfile> {
    const rows = await CompetitionPreferenceRepository.findByUser(userId);

    return rows.map((row) => ({
      dimension: row.dimension as DimensionId,
      value: row.value,
      weight: row.weight,
    }));
  }
}
