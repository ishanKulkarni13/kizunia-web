"use client";

import { useCompetitionEditorStore } from "@/modules/competitions/store/editor-store";
import { deriveFieldStatus } from "@/modules/competitions/editor/field-status";
import {
  FIELD_METADATA,
  type EditorTab,
} from "@/modules/competitions/editor/field-metadata";
import type { CompetitionEditDTOWithPermissions } from "@/modules/competitions/types/edit-dto";

/**
 * A lightweight "N fields not specified" line for the end of a data-entry
 * tab — never a banner, never a card, never a blocker. Deliberately does
 * not duplicate any validation: it only reads `FIELD_METADATA` (which tab a
 * field belongs to, and whether "not specified" is meaningful for it) and
 * `deriveFieldStatus` (already the single source of NULL/UNSAVED/DONE).
 *
 * The Summary tab is the primary overview; this exists only so a long form
 * doesn't require a trip to Summary just to see what's left on the current
 * tab.
 */
export function TabCompletenessFooter({ tab }: { tab: EditorTab }) {
  const competition = useCompetitionEditorStore((s) => s.competition);
  const original = useCompetitionEditorStore((s) => s.original);

  if (!competition || !original) return null;

  const missing = FIELD_METADATA.filter(
    (meta) => meta.tab === tab && meta.nullable,
  ).filter((meta) => {
    const key = meta.key as keyof CompetitionEditDTOWithPermissions;
    const current = competition[key];
    const saved = original[key];
    return deriveFieldStatus(current, saved) === "NULL";
  });

  if (missing.length === 0) return null;

  return (
    <div className="mt-2 border-t pt-4 text-sm text-muted-foreground">
      {missing.length} field{missing.length === 1 ? "" : "s"} not specified:{" "}
      {missing.map((m) => m.label).join(", ")}
    </div>
  );
}
