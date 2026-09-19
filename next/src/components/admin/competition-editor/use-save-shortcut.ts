"use client";

import { useEffect } from "react";
import { useCompetitionEditorStore } from "@/modules/competitions/store/editor-store";

/**
 * Ctrl+S (Windows/Linux) / Cmd+S (macOS) triggers the exact same
 * `save()` the Save button calls — no separate persistence path, so every
 * outcome (no-op when clean, no-op while already saving, validation
 * failure, API failure, success) is handled once, in the store.
 *
 * `metaKey || ctrlKey` covers both platforms without user-agent sniffing.
 * `preventDefault()` suppresses the browser's own "Save page" dialog.
 * Mounted once at the editor root so it fires regardless of which tab is
 * active, rather than living in the header (which could unmount
 * independently of the tab content).
 */
export function useSaveShortcut() {
  const save = useCompetitionEditorStore((s) => s.save);
  const isDirty = useCompetitionEditorStore((s) => s.isDirty);
  const saving = useCompetitionEditorStore((s) => s.saving);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const isSaveShortcut =
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "s";

      if (!isSaveShortcut) return;

      event.preventDefault();

      if (saving || !isDirty()) return;

      void save();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [save, isDirty, saving]);
}

/**
 * Warns before an unload (tab close, refresh, navigation away) while there
 * are unsaved changes. Native `beforeunload` cannot show custom text in
 * modern browsers — setting `returnValue` is what triggers the browser's
 * own generic prompt.
 */
export function useUnsavedChangesGuard() {
  const isDirty = useCompetitionEditorStore((s) => s.isDirty);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!isDirty()) return;
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () =>
      window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);
}
