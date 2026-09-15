import type { CompetitionCardDTO } from "@/modules/competitions/types/dto";
import type { RecommendationDiagnostics } from "../engine";

export interface RecommendationItemDTO {
  readonly competition: CompetitionCardDTO;
  readonly score: number;
  readonly rank: number;
}

/**
 * `userId -> RecommendationResult` — the Phase 0 contract in full.
 *
 * `items` is the long-term public shape. `diagnostics` is present only when
 * explicitly requested (`includeDiagnostics: true`) — the internal tuning
 * route asks for it; a future public-facing API would not. See
 * `docs/architecture/recommendation/result-contract.md`.
 */
export interface RecommendationResultDTO {
  readonly userId: string;
  readonly generatedAt: string;
  readonly items: readonly RecommendationItemDTO[];
  readonly diagnostics?: RecommendationDiagnostics;
}
