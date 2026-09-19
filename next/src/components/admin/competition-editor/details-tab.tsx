"use client";

import { useCompetitionEditorStore } from "@/modules/competitions/store/editor-store";

export function DetailsTab() {
  const competition = useCompetitionEditorStore(
    (state) => state.competition,
  );

  if (!competition) {
    return null;
  }

  return (
    <pre className="mt-6 rounded-lg border bg-muted p-4 text-sm overflow-auto">
      {JSON.stringify(competition, null, 2)}
    </pre>
  );
}