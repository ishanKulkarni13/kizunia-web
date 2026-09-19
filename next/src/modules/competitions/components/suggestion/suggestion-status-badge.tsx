/**
 * Competition Suggestions - Status badge
 *
 * Same pattern as `../status-badge.tsx` (Competition's own status badge):
 * one place a `CompetitionSuggestionStatus` becomes a label + color a person
 * reads, replacing the ad-hoc `formatStatus()` that had grown up in the
 * contributor detail view.
 */

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { SUGGESTION_STATUS_OPTIONS } from "../../constants";
import type { CompetitionSuggestionStatus } from "../../types/suggestion";

const STATUS_TONE: Record<CompetitionSuggestionStatus, string> = {
  DRAFT: "border-transparent bg-muted text-muted-foreground",
  UNDER_REVIEW:
    "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300",
  CHANGES_REQUESTED:
    "border-transparent bg-blue-500/15 text-blue-700 dark:text-blue-300",
  APPROVED:
    "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  REJECTED: "border-transparent bg-destructive/15 text-destructive",
  WITHDRAWN: "border-transparent bg-muted text-muted-foreground",
};

export function SuggestionStatusBadge({
  status,
  className,
}: {
  status: CompetitionSuggestionStatus;
  className?: string;
}) {
  const label =
    SUGGESTION_STATUS_OPTIONS.find((option) => option.value === status)
      ?.label ?? status;

  return (
    <Badge className={cn(STATUS_TONE[status], className)}>{label}</Badge>
  );
}
