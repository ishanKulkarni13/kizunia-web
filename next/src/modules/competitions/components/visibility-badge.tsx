/**
 * Competitions - Visibility badge
 *
 * See `status-badge.tsx` — same reasoning, same reuse of the shared options
 * constant. Built alongside the fix to `COMPETITION_VISIBILITY_OPTIONS`
 * (which previously listed only two of the enum's four values), so every
 * consumer of this badge automatically covers all four.
 */

import type { CompetitionVisibility } from "@/generated/prisma";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { COMPETITION_VISIBILITY_OPTIONS } from "../constants";

const VISIBILITY_TONE: Record<CompetitionVisibility, string> = {
  PUBLIC:
    "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  UNLISTED: "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300",
  PRIVATE: "border-transparent bg-destructive/15 text-destructive",
  ARCHIVED: "border-transparent bg-muted text-muted-foreground",
};

export function VisibilityBadge({
  visibility,
  className,
}: {
  visibility: CompetitionVisibility;
  className?: string;
}) {
  const label =
    COMPETITION_VISIBILITY_OPTIONS.find((option) => option.value === visibility)
      ?.label ?? visibility;

  return (
    <Badge className={cn(VISIBILITY_TONE[visibility], className)}>
      {label}
    </Badge>
  );
}
