/**
 * Recommendations — Candidate Service
 *
 * The candidate-selection boundary: turns "give me candidates" into a
 * Prisma read (via `CandidateRepository`) plus mapping (via
 * `RecommendationMapper`), and hands the engine plain `RecommendationCandidate`
 * objects. Kept as its own stage — separate from ranking/scoring — so that
 * future optimizations (narrowing further in SQL, caching, batching across
 * users) are changes to this one file, not to the engine. See
 * `docs/architecture/recommendation/candidate-selection.md`.
 */
import type { CompetitionCardDTO } from "@/modules/competitions/types/dto";
import type { RecommendationCandidate } from "../engine";
import { CandidateRepository } from "./candidate.repository";
import { recommendationMapper } from "./mapper";

export interface CandidateSelection {
  readonly candidates: readonly RecommendationCandidate[];
  /** Display DTOs for the same candidates, keyed by competition id. */
  readonly cardsById: ReadonlyMap<string, CompetitionCardDTO>;
}

export class CandidateService {
  /**
   * Phase 0's candidate universe is not user-specific — every user is
   * evaluated against the same open-registration competitions, and
   * per-user narrowing (e.g. excluding what they already registered for)
   * is Phase 1 territory. `limit` is the cost guard from
   * `RecommendationConfig.candidateLimit`.
   */
  static async selectOpen(options: { limit: number }): Promise<CandidateSelection> {
    const rows = await CandidateRepository.selectOpenForRecommendation(options.limit);

    const candidates: RecommendationCandidate[] = [];
    const cardsById = new Map<string, CompetitionCardDTO>();

    for (const row of rows) {
      candidates.push(recommendationMapper.toCandidate(row));
      cardsById.set(row.id, recommendationMapper.toCardDTO(row));
    }

    return { candidates, cardsById };
  }
}
