import type { SuggestionStatus } from "@/generated/prisma";

export interface CompetitionSuggestionAdminTableDTO {
  id: string;
  suggestionTitle: string;
  status: SuggestionStatus;

  submittedAt: Date | null;
  createdAt: Date;
  reviewedAt: Date | null;

  submitter: {
    id: string;
    name: string;
    email: string;
  };

  assetCount: number;

  /**
   * Whether the review action set (approve/reject/request changes) is
   * currently available for this row, as decided by
   * `CompetitionSuggestionPolicy` — never re-derived from role/status on the
   * client.
   */
  canReview: boolean;
}
