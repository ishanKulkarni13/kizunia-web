/**
 * Recommendations — Service
 *
 * The Phase 0 contract, end to end: `userId -> RecommendationResult`.
 * Everything below `normalizeProfile` is the pure engine
 * (`runRecommendationPipeline`); everything above it is this file's job —
 * load a profile, load candidates, run the pipeline, map ranked ids back to
 * display DTOs.
 *
 * Responsibilities
 * ----------------
 * ✓ Orchestrate profile loading + candidate selection + the engine
 * ✓ Map the pipeline's `RankedCandidate[]` back to `CompetitionCardDTO`s
 *
 * Does NOT
 * ----------------
 * ✗ Contain any scoring, eligibility, or ranking logic itself
 * ✗ Know about notifications, delivery, or persistence
 */
import { normalizeProfile, runRecommendationPipeline } from "../engine";
import type { DimensionId, PreferenceEntry, RecommendationConfig } from "../engine";
import { defaultRecommendationConfig } from "../config/recommendation-config";
import { CandidateService } from "./candidate.service";
import {
  DummyPreferenceProfileProvider,
  ExplicitProfileProvider,
  type PreferenceProfileProvider,
} from "./preference-profile.provider";
import type { RecommendationResultDTO } from "../types/recommendation.dto";

export interface GenerateRecommendationsOptions {
  readonly userId: string;
  /** Tuning overrides for the internal testing route; production callers omit these. */
  readonly profileOverrides?: readonly PreferenceEntry[];
  readonly threshold?: number;
  readonly topN?: number;
  readonly enabledDimensions?: readonly DimensionId[];
  readonly includeDiagnostics?: boolean;
}

const defaultProvider: PreferenceProfileProvider = new DummyPreferenceProfileProvider();

export class RecommendationService {
  /**
   * The Phase 0 entry point. `userId` is the only required input — see
   * `docs/architecture/recommendation/README.md`.
   */
  static async generateForUser(
    options: GenerateRecommendationsOptions,
  ): Promise<RecommendationResultDTO> {
    const provider: PreferenceProfileProvider = options.profileOverrides
      ? new ExplicitProfileProvider(options.profileOverrides)
      : defaultProvider;

    const entries = await provider.load(options.userId);
    const profile = normalizeProfile(entries);

    const config: RecommendationConfig = defaultRecommendationConfig({
      threshold: options.threshold,
      topN: options.topN,
      enabledDimensions: options.enabledDimensions
        ? new Set(options.enabledDimensions)
        : undefined,
    });

    const { candidates, cardsById } = await CandidateService.selectOpen({
      limit: config.candidateLimit,
    });

    const { ranked, diagnostics } = runRecommendationPipeline({
      profile,
      candidates,
      config,
    });

    const items = ranked
      .map((r) => {
        const competition = cardsById.get(r.candidateId);
        return competition ? { competition, score: r.score, rank: r.rank } : null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return {
      userId: options.userId,
      generatedAt: new Date().toISOString(),
      items,
      diagnostics: options.includeDiagnostics ? diagnostics : undefined,
    };
  }
}
