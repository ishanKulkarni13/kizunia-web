import type { CompetitionStatus } from "@/generated/prisma";
import type { LifecycleReason } from "../lifecycle";

/**
 * One row of the admin lifecycle preview: a competition whose automatically
 * derived status differs from what is currently persisted. Only actionable
 * rows are ever represented by this DTO — a competition whose status would
 * not change is never mapped into one.
 */
export interface LifecyclePreviewRowDTO {
  readonly id: string;
  readonly title: string;
  readonly slug: string;

  readonly currentStatus: CompetitionStatus | null;
  readonly proposedStatus: CompetitionStatus | null;

  readonly reason: LifecycleReason;
  /** ISO 8601, or null when the reason has no associated date. */
  readonly drivingDate: string | null;

  readonly automaticStatusUpdatesDisabled: boolean;
  readonly statusUpdatedAt: string | null;
}

/** One row the apply step could not update, and why. */
export interface LifecycleApplySkippedRowDTO {
  readonly id: string;
  readonly reason:
    | "NOT_FOUND"
    | "DELETED"
    | "AUTOMATION_DISABLED"
    | "NO_CHANGE"
    | "CANCELLED";
}

export interface LifecycleApplyResultDTO {
  readonly applied: number;
  readonly skipped: readonly LifecycleApplySkippedRowDTO[];
}

export interface LifecycleSweepSummary {
  readonly scanned: number;
  readonly changed: number;
  readonly byTransition: Record<string, number>;
  readonly startedAt: string;
  readonly finishedAt: string;
}
