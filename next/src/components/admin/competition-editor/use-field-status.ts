import { useCompetitionEditorStore } from "@/modules/competitions/store/editor-store";
import { deriveFieldStatus } from "@/modules/competitions/editor/field-status";
import { buildUpdateCompetitionPayload } from "@/modules/competitions/editor/build-update-payload";
import type { CompetitionEditDTOWithPermissions } from "@/modules/competitions/types/edit-dto";

/**
 * Subscribes to one field's NULL/UNSAVED/DONE status, derived from the
 * store's `competition` vs `original` — see `field-status.ts`. Returns
 * `undefined` before the editor has initialized, so callers can omit the
 * badge entirely rather than show a misleading default.
 */
export function useFieldStatus<K extends keyof CompetitionEditDTOWithPermissions>(
  key: K,
) {
  return useCompetitionEditorStore((state) => {
    if (!state.competition || !state.original) return undefined;
    return deriveFieldStatus(state.competition[key], state.original[key]);
  });
}

/**
 * Whether the draft differs from the last-persisted snapshot, computed
 * inside the selector itself — the same shape as `useFieldStatus` above —
 * rather than selecting the store's `isDirty` method and calling it during
 * render. Both derive from the same `buildUpdateCompetitionPayload`, so
 * this is equivalent to `useCompetitionEditorStore((s) => s.isDirty)()` in
 * every case; it exists so the header and field badges share one
 * structural pattern instead of two that merely happen to agree.
 */
export function useIsDirty(): boolean {
  return useCompetitionEditorStore((state) => {
    if (!state.competition || !state.original) return false;
    return (
      Object.keys(
        buildUpdateCompetitionPayload(state.competition, state.original),
      ).length > 0
    );
  });
}
