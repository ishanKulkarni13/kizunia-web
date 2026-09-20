/**
 * Recommendation Engine — Core Types (PURE)
 *
 * =============================================================================
 * What lives here
 * =============================================================================
 *
 * Every contract the pipeline stages (`profile.ts`, `dimensions/*`,
 * `eligibility.ts`, `scoring.ts`, `ranking.ts`, `pipeline.ts`) are built
 * against. Nothing in this file imports Prisma, Next.js, or anything else
 * that touches I/O — see the module README for why that boundary matters.
 *
 * `RecommendationCandidate` is deliberately its own shape, not a Prisma
 * payload type. The engine must be able to run against a hand-built object
 * in a unit test with zero database involvement; if it depended on a Prisma
 * `GetPayload` type, that would stop being possible.
 */

// =============================================================================
// Dimensions
// =============================================================================

/**
 * The full set of dimensions the engine knows about in Phase 0.
 *
 * Deliberately excludes `startDate`, `endDate`, `registrationDeadline` and
 * `registrationStartDate` — those remain ordinary competition fields, used
 * only as ranking tiebreakers (see `ranking.ts`), never registered here or
 * scored. See `docs/architecture/recommendation/dimensions.md` for why, and
 * `future.md` for how a temporal dimension would be added back.
 */
export const DimensionId = {
  MODE: "mode",
  CATEGORIES: "categories",
  TECHNOLOGIES: "technologies",
  ELIGIBILITIES: "eligibilities",
  LOCATION: "location",
  REGISTRATION_PLATFORM: "registrationPlatform",
  REGISTRATION_TYPE: "registrationType",
  REGISTRATION_FEE_TYPE: "registrationFeeType",
  ORGANIZER_TYPE: "organizerType",
  DIFFICULTY: "difficulty",
  CERTIFICATE_TYPE: "certificateType",
  STATUS: "status",
  TEAM_SIZE: "teamSize",
} as const;

export type DimensionId = (typeof DimensionId)[keyof typeof DimensionId];

// =============================================================================
// Preference profile (input)
// =============================================================================

/**
 * One `(dimension, value, weight)` fact about what a user cares about.
 *
 * Several entries may share a `dimension` — that is how multi-value
 * preferences within one dimension are expressed (e.g. `Pune 1.0` and
 * `Mumbai 0.7` are two entries, both `dimension: "location"`).
 */
export interface PreferenceEntry {
  readonly dimension: DimensionId;
  /** A value comparable to what `RecommendationDimension.extract` returns. */
  readonly value: string;
  /** `[0, 1]`. `0` = no preference, `(0,1)` = soft, `1` = hard constraint. */
  readonly weight: number;
}

export type PreferenceProfile = readonly PreferenceEntry[];

/**
 * `PreferenceEntry[]` normalized per-dimension. Produced by `profile.ts`
 * and consumed by every later stage — nothing downstream re-derives this
 * from raw entries.
 */
export interface DimensionPreference {
  readonly dimension: DimensionId;
  /** `true` iff any entry in this dimension has weight `1` (hard dominance). */
  readonly hard: boolean;
  /** value -> weight. When `hard`, contains only the weight-1 values. */
  readonly values: ReadonlyMap<string, number>;
  /** max weight across the dimension's (surviving) values. Always in (0, 1]. */
  readonly userStrength: number;
}

/** A normalized profile is only the dimensions the user actually expressed. */
export type NormalizedProfile = ReadonlyMap<DimensionId, DimensionPreference>;

// =============================================================================
// Candidates (input)
// =============================================================================

/**
 * The engine's view of a competition. A backend adapter (`backend/mapper.ts`)
 * is responsible for producing this from Prisma data; the engine never sees
 * a Prisma model.
 *
 * Date fields are included only because ranking needs a deterministic,
 * domain-meaningful tiebreaker — see `ranking.ts`. They are never read by a
 * dimension or the scorer.
 */
export interface RecommendationCandidate {
  readonly id: string;
  readonly mode: string | null;
  readonly status: string | null;
  readonly minTeamSize: number | null;
  readonly maxTeamSize: number | null;
  readonly registrationType: string | null;
  readonly registrationFeeType: string | null;
  readonly registrationPlatform: string | null;
  readonly organizerType: string | null;
  readonly difficulty: string | null;
  readonly certificateType: string | null;
  readonly categorySlugs: readonly string[];
  readonly technologySlugs: readonly string[];
  readonly eligibilityTypes: readonly string[];
  /** Reachable `SearchArea` ids for this competition's location(s). Empty = unknown. */
  readonly searchAreaIds: readonly string[];
  /** Tiebreakers only — see the module docstring above. */
  readonly startDate: Date | null;
  readonly registrationDeadline: Date | null;
}

// =============================================================================
// Dimension evaluation (intermediate)
// =============================================================================

export type MatchOutcome = "MATCH" | "MISMATCH" | "MISSING";

export interface DimensionSignal {
  readonly dimension: DimensionId;
  readonly outcome: MatchOutcome;
  /**
   * How strongly this outcome matched, in `(0, 1]` for MATCH and `0`
   * otherwise. For a MATCH against multiple preferred values, this is the
   * matched value's own weight relative to the dimension's `userStrength`
   * — see `scoring.ts`.
   */
  readonly strength: number;
  /** The candidate value(s) that produced this outcome, for diagnostics. */
  readonly candidateValues: readonly string[];
}

// =============================================================================
// Dimension contract
// =============================================================================

export interface RecommendationDimension {
  readonly id: DimensionId;
  /**
   * Comparable values this candidate carries for this dimension.
   * `null` means the competition has no data for it (distinct from `[]`,
   * which a dimension may never actually need but is not forbidden either).
   */
  extract(candidate: RecommendationCandidate): readonly string[] | null;
  /**
   * Optional escape hatch for dimensions whose match logic is not "is any
   * preferred value present in what the candidate carries" — e.g. team size
   * containment. Defaults to `defaultSetMatch` (see `dimensions/set-dimension.ts`).
   */
  match?(
    preference: DimensionPreference,
    candidate: RecommendationCandidate,
  ): DimensionSignal;
}

// =============================================================================
// Eligibility (hard-constraint stage)
// =============================================================================

export interface EligibilityRejection {
  readonly dimension: DimensionId;
  readonly reason: "HARD_MISMATCH" | "HARD_MISSING";
}

export interface EligibilityResult {
  readonly eligible: boolean;
  /** Present iff `eligible` is false. The first hard constraint that failed. */
  readonly rejection?: EligibilityRejection;
  /** Every hard-dimension signal computed, eligible or not — for diagnostics. */
  readonly signals: readonly DimensionSignal[];
}

// =============================================================================
// Scoring
// =============================================================================

export interface DimensionContribution {
  readonly dimension: DimensionId;
  readonly systemWeight: number;
  readonly userStrength: number;
  readonly effectiveWeight: number;
  readonly signal: DimensionSignal;
}

export interface ScoringResult {
  readonly score: number;
  readonly contributions: readonly DimensionContribution[];
}

export interface ScoringStrategy {
  readonly id: string;
  score(input: {
    readonly profile: NormalizedProfile;
    readonly candidate: RecommendationCandidate;
    readonly signals: readonly DimensionSignal[];
    readonly systemWeights: Readonly<Record<DimensionId, number>>;
    readonly enabledDimensions: ReadonlySet<DimensionId>;
  }): ScoringResult;
}

// =============================================================================
// Pipeline configuration
// =============================================================================

export interface RecommendationConfig {
  readonly enabledDimensions: ReadonlySet<DimensionId>;
  readonly systemWeights: Readonly<Record<DimensionId, number>>;
  readonly threshold: number;
  readonly topN: number;
  readonly candidateLimit: number;
  readonly scorer: ScoringStrategy;
}

// =============================================================================
// Result (output)
// =============================================================================

export type RejectionReason =
  | { readonly kind: "HARD_CONSTRAINT"; readonly dimension: DimensionId }
  | { readonly kind: "BELOW_THRESHOLD"; readonly score: number }
  | { readonly kind: "BEYOND_TOP_N" };

export interface RecommendationTrace {
  readonly candidateId: string;
  readonly score: number | null;
  readonly rejection: RejectionReason | null;
  readonly contributions: readonly DimensionContribution[];
}

export interface RankedCandidate {
  readonly candidateId: string;
  readonly score: number;
  readonly rank: number;
}

export interface RecommendationDiagnostics {
  readonly candidatesEvaluated: number;
  readonly rejectedByHardConstraint: number;
  readonly belowThreshold: number;
  readonly returned: number;
  readonly activeDimensions: readonly {
    readonly dimension: DimensionId;
    readonly userStrength: number;
    readonly systemWeight: number;
    readonly effectiveWeight: number;
  }[];
  readonly traces: readonly RecommendationTrace[];
}

export interface PipelineResult {
  readonly ranked: readonly RankedCandidate[];
  readonly diagnostics: RecommendationDiagnostics;
}
