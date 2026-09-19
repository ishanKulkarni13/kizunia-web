"use client";

import { useEffect } from "react";
import type { CompetitionEditDTOWithPermissions } from "@/modules/competitions/types/edit-dto";
import { useCompetitionEditorStore } from "@/modules/competitions/store/editor-store";
import { EditorHeader } from "./editor-header";
import { CompetitionEditorNavigation } from "./competition-editor-navigation";
import { useSaveShortcut, useUnsavedChangesGuard } from "./use-save-shortcut";

/**
 * Shell mounted once per competition, at the `[id]/layout.tsx` level, so it
 * persists across client-side navigation between tab routes (unlike the
 * old single-page `CompetitionEditor`, which held `activeTab` in local
 * `useState` and re-rendered the whole tab tree on every switch instead of
 * actually navigating).
 */
export function CompetitionEditorShell({
  competition,
  children,
}: {
  competition: CompetitionEditDTOWithPermissions;
  children: React.ReactNode;
}) {
  const initialize = useCompetitionEditorStore((state) => state.initialize);

  useEffect(() => {
    initialize(competition);
  }, [competition, initialize]);

  useSaveShortcut();
  useUnsavedChangesGuard();

  const editedCompetition = useCompetitionEditorStore((s) => s.competition);

  if (!editedCompetition) {
    return null;
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 md:p-6">
      <EditorHeader />

      <div className="rounded-xl border bg-card">
        <div className="px-4 pt-2">
          <CompetitionEditorNavigation competitionId={competition.id} />
        </div>

        <div className="px-4 pb-6">{children}</div>
      </div>
    </div>
  );
}
