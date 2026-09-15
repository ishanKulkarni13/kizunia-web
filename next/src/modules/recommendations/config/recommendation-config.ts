/**
 * Recommendation Engine — Configuration
 *
 * Every tunable number in the feature lives here: which dimensions are on,
 * how much each one counts (system weight), the relevance floor
 * (threshold), and how many results to return (Top-N). This is
 * code-configuration by design (see prompt §22/§15) — no admin UI, no
 * database-stored algorithm configuration. Changing behavior is a one-line
 * edit to this file, not a change scattered across the engine.
 *
 * =============================================================================
 * System weights — rationale
 * =============================================================================
 *
 * These express how much *Kizunia* weighs a dimension's signal, independent
 * of how much any individual user weighs it (`DimensionPreference.userStrength`,
 * the user weight). The two multiply together in `scoring.ts`.
 *
 *   categories             1.00  What the competition is *about* — the
 *                                 strongest topical signal available.
 *   technologies           0.90  Topical, but noisier: tech stacks are often
 *                                 only partially listed on a competition.
 *   location                0.80  Feasibility — attending an offline event
 *                                 far away is a real, practical barrier.
 *   eligibilities           0.80  Feasibility — often genuinely disqualifying
 *                                 (a UG-only competition is not "less ideal"
 *                                 for a PG student, it is inapplicable).
 *   mode                    0.70  Feasibility, but coarser-grained than
 *                                 location or eligibility.
 *   registrationFeeType     0.60  A real constraint for many users, but only
 *                                 three possible values limits how much it
 *                                 can discriminate between competitions.
 *   difficulty               0.50  Fit signals: relevant, but weaker and more
 *   registrationType         0.50   often left unset than the feasibility
 *   teamSize                 0.50   dimensions above.
 *   status                   0.40  Mostly redundant with candidate selection,
 *                                 which already narrows to REGISTRATION_OPEN
 *                                 competitions — see `candidate-selection.md`.
 *   organizerType            0.30  Weak preference signals: informative, but
 *   registrationPlatform     0.30   rarely the reason someone wants a
 *                                 competition.
 *   certificateType          0.20  Least discriminating dimension in the set
 *                                 — the canonical "matters less than
 *                                 category" example from the product brief.
 *
 * Startdate/endDate/registrationDeadline/registrationStartDate are
 * deliberately absent — Phase 0 does not register them as dimensions at
 * all (see `engine/types.ts`'s `DimensionId`); they exist only as ranking
 * tiebreakers.
 */
import {
  DimensionId,
  WeightedCoverageScorer,
  type RecommendationConfig,
} from "../engine";

export const SYSTEM_WEIGHTS: Readonly<Record<DimensionId, number>> = {
  [DimensionId.CATEGORIES]: 1.0,
  [DimensionId.TECHNOLOGIES]: 0.9,
  [DimensionId.LOCATION]: 0.8,
  [DimensionId.ELIGIBILITIES]: 0.8,
  [DimensionId.MODE]: 0.7,
  [DimensionId.REGISTRATION_FEE_TYPE]: 0.6,
  [DimensionId.DIFFICULTY]: 0.5,
  [DimensionId.REGISTRATION_TYPE]: 0.5,
  [DimensionId.TEAM_SIZE]: 0.5,
  [DimensionId.STATUS]: 0.4,
  [DimensionId.ORGANIZER_TYPE]: 0.3,
  [DimensionId.REGISTRATION_PLATFORM]: 0.3,
  [DimensionId.CERTIFICATE_TYPE]: 0.2,
};

/** Every dimension the registry knows about is enabled by default in Phase 0. */
export const ENABLED_DIMENSIONS: ReadonlySet<DimensionId> = new Set(
  Object.values(DimensionId),
);

/**
 * A candidate must clear at least half of the weighted preference mass the
 * user actually expressed to be considered relevant. Chosen as a round,
 * explainable starting point — not derived from data, and expected to move
 * once real usage exists. Documented here, not buried in the scorer, so it
 * is the one number anyone tuning relevance needs to find.
 */
export const DEFAULT_THRESHOLD = 0.5;

/** How many ranked results a single evaluation returns, at most. */
export const DEFAULT_TOP_N = 5;

/**
 * A Phase 0 cost guard, not a product decision: candidate selection reads at
 * most this many open-registration competitions per evaluation. Revisit
 * once real candidate volume and the batching questions in
 * `docs/architecture/notifications/recommendation/candidate-selection.md`
 * are addressed for Phase 1's cron-driven execution.
 */
export const DEFAULT_CANDIDATE_LIMIT = 500;

export function defaultRecommendationConfig(
  overrides?: Partial<
    Pick<RecommendationConfig, "threshold" | "topN" | "enabledDimensions">
  >,
): RecommendationConfig {
  return {
    enabledDimensions: overrides?.enabledDimensions ?? ENABLED_DIMENSIONS,
    systemWeights: SYSTEM_WEIGHTS,
    threshold: overrides?.threshold ?? DEFAULT_THRESHOLD,
    topN: overrides?.topN ?? DEFAULT_TOP_N,
    candidateLimit: DEFAULT_CANDIDATE_LIMIT,
    scorer: WeightedCoverageScorer,
  };
}
