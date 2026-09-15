/**
 * Recommendations — Preference Profile Provider
 *
 * =============================================================================
 * Why a port, and why a dummy adapter behind it
 * =============================================================================
 *
 * `userId -> PreferenceProfile` is the one input the engine needs that does
 * not come from the competition domain. No weighted preference storage
 * exists anywhere in the schema today — `NotificationPreference` is legacy
 * and untyped, and is not being repurposed here (see open decision A-2 in
 * `docs/project/feature-specification/notification/open-decisions.md`,
 * which Phase 0 deliberately leaves open). Per explicit product direction,
 * Phase 0 also does not read `User.interests`/`UserCategory` or any
 * portfolio field as a preference source — that relation has been removed
 * from the domain entirely (see the schema migration
 * `remove_user_category_interests`).
 *
 * So Phase 0 uses `DummyPreferenceProfileProvider`: the same hardcoded,
 * representative profile for every user, good enough to exercise the whole
 * pipeline end-to-end (`userId -> RecommendationResult`) by hand. The port
 * is what makes this a *temporary* choice rather than a structural one —
 * when a real, persisted preference model exists, a new adapter replaces
 * `DummyPreferenceProfileProvider` in `recommendation.service.ts` and
 * nothing else in this module changes.
 */
import { DimensionId, type PreferenceEntry, type PreferenceProfile } from "../engine";

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
