import type { AssetDTO } from "@/modules/assets/frontend/types";

export type CompetitionSuggestionStatus =
  | "DRAFT"
  | "UNDER_REVIEW"
  | "CHANGES_REQUESTED"
  | "APPROVED"
  | "REJECTED"
  | "WITHDRAWN";

export interface CompetitionSuggestionContent {
  id: string;
  content: string;
  version?: number;
}

export interface CompetitionSuggestionAssetDTO {
  assetId: string;
  order: number;
  createdAt: string | Date;
  asset: AssetDTO;
}

export interface CompetitionSuggestionDTO {
  id: string;
  suggestionTitle: string;

  suggestionContent: CompetitionSuggestionContent | null;

  status: CompetitionSuggestionStatus;

  submittedAt: string | Date | null;
  reviewedAt: string | Date | null;

  reviewNotes: string | null;
  rejectionReason: string | null;

  competitionId: string | null;

  assets: CompetitionSuggestionAssetDTO[];

  createdAt: string | Date;
  updatedAt: string | Date;

  deletedAt?: string | Date | null;
}

// =============================================================================
// Admin Review
// =============================================================================

export type CompetitionSuggestionAdminQueryStatus =
  | "UNDER_REVIEW"
  | "DRAFT"
  | "CHANGES_REQUESTED"
  | "APPROVED"
  | "REJECTED"
  | "WITHDRAWN"
  | "ALL";

export interface CompetitionSuggestionAdminTableDTO {
  id: string;
  suggestionTitle: string;
  status: CompetitionSuggestionStatus;

  submittedAt: string | Date | null;
  createdAt: string | Date;
  reviewedAt: string | Date | null;

  submitter: {
    id: string;
    name: string;
    email: string;
  };

  assetCount: number;

  canReview: boolean;
}

export interface CompetitionSuggestionAdminDetailDTO {
  id: string;
  suggestionTitle: string;
  status: CompetitionSuggestionStatus;

  suggestionContent: CompetitionSuggestionContent | null;

  submittedAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  reviewedAt: string | Date | null;

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