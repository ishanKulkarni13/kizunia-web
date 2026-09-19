import type { SuggestionStatus } from "@/generated/prisma";
import type { CompetitionSuggestionAssetDTO } from "../../../../types/suggestion";

/** Why each disabled review button is disabled — shown as a tooltip. One
 * mapping, shared by the list and detail pages, so they never disagree. */
export function suggestionReviewBlockedReason(
  status: SuggestionStatus,
): string | null {
  switch (status) {
    case "DRAFT":
      return "Not yet submitted for review.";
    case "CHANGES_REQUESTED":
      return "Waiting on the contributor to resubmit.";
    case "APPROVED":
    case "REJECTED":
      return "This suggestion has already been decided.";
    case "WITHDRAWN":
      return "Withdrawn by the contributor.";
    case "UNDER_REVIEW":
      return null;
    default:
      return null;
  }
}

export interface CompetitionSuggestionAdminDetailDTO {
  id: string;
  suggestionTitle: string;
  status: SuggestionStatus;

  suggestionContent: { id: string; content: string; version?: number } | null;

  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  reviewedAt: Date | null;

  reviewNotes: string | null;
  rejectionReason: string | null;

  competitionId: string | null;

  submitter: {
    id: string;
    name: string;
    email: string;
  };

  reviewedBy: {
    id: string;
    name: string;
  } | null;

  assets: CompetitionSuggestionAssetDTO[];

  canApprove: boolean;
  canReject: boolean;
  canRequestChanges: boolean;
  canRemoveAssets: boolean;
  reviewBlockedReason: string | null;
}
