"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { FieldStatus } from "@/modules/competitions/editor/field-status";

/**
 * Visual tone per status, kept separate from the badge's own variant
 * system — same pattern as `StatusBadge`'s `STATUS_TONE`. This is an
 * administrative state (editor vs. persisted value), never a validation
 * result — see `field-status.ts`'s module doc.
 */
const STATUS_TONE: Record<FieldStatus, string> = {
  NULL: "border-transparent bg-muted text-muted-foreground",
  UNSAVED:
    "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300",
  DONE:
    "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};

const STATUS_LABEL: Record<FieldStatus, string> = {
  NULL: "Not specified",
  UNSAVED: "Unsaved",
  DONE: "Done",
};

export function FieldStatusBadge({
  status,
  className,
}: {
  status: FieldStatus;
  className?: string;
}) {
  return (
    <Badge className={cn(STATUS_TONE[status], className)}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}
