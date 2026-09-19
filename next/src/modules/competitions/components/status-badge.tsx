/**
 * Competitions - Status badge
 *
 * The one place a `CompetitionStatus` becomes a label a person reads.
 * Replaces the several `.replaceAll("_", " ")` formatters that had grown up
 * independently across the public detail page and both suggestions pages —
 * each one a slightly different way of saying the same enum, none of them
 * sharing a color. Every consumer of a status now gets the same label and
 * the same color, from the one source `COMPETITION_STATUS_OPTIONS` already
 * was.
 */

import type { CompetitionStatus } from "@/generated/prisma";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { COMPETITION_STATUS_OPTIONS } from "../constants";

/**
 * Semantic color per status, kept separate from the badge's own visual
 * variant system — this is meaning (open vs. closed vs. done), not styling.
 */
const STATUS_TONE: Record<CompetitionStatus, string> = {
  UPCOMING: "border-transparent bg-blue-500/15 text-blue-700 dark:text-blue-300",
  REGISTRATION_OPEN:
    "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  REGISTRATION_CLOSED:
    "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300",
  ONGOING: "border-transparent bg-violet-500/15 text-violet-700 dark:text-violet-300",
  COMPLETED: "border-transparent bg-muted text-muted-foreground",
  CANCELLED: "border-transparent bg-destructive/15 text-destructive",
};

export function StatusBadge({
  status,
  className,
}: {
  status: CompetitionStatus | null;
  className?: string;
}) {
  if (!status) {
    return (
      <Badge variant="outline" className={cn("text-muted-foreground", className)}>
        No status
      </Badge>
    );
  }

  const label =
    COMPETITION_STATUS_OPTIONS.find((option) => option.value === status)
      ?.label ?? status;

  return (
    <Badge className={cn(STATUS_TONE[status], className)}>{label}</Badge>
  );
}
