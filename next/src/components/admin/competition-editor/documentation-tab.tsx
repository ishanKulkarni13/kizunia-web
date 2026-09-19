"use client";

import { Suspense, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ForwardRefEditor } from "@/components/shared/mdx/ForwardRefEditor";
import { useCompetitionEditorStore } from "@/modules/competitions/store/editor-store";
import { FieldStatusBadge } from "./field-status-badge";
import { useFieldStatus } from "./use-field-status";
import { useScrollToFocusedField } from "./use-scroll-to-focused-field";

export function DocumentationTab() {
  useScrollToFocusedField();

  const competition = useCompetitionEditorStore((state) => state.competition);

  const updateCompetition = useCompetitionEditorStore(
    (state) => state.updateCompetition,
  );

  const contentStatus = useFieldStatus("content");

  // Only bumped by the explicit "Clear documentation" action below — forces
  // MDXEditor to remount with the (now empty) markdown, since its
  // `markdown` prop is read once on mount and never resynced afterwards.
  // Bumping this on every keystroke would reset the cursor mid-typing, so
  // ordinary edits never touch it.
  const [resetKey, setResetKey] = useState(0);

  if (!competition) {
    return null;
  }

  const hasContent = competition.content !== null;

  return (
    <div id="field-content" className="space-y-3 pt-6 text-foreground">
      <div className="flex items-center justify-between gap-2">
        {contentStatus && <FieldStatusBadge status={contentStatus} />}

        {hasContent && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm">
                Clear documentation
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear documentation?</AlertDialogTitle>
                <AlertDialogDescription>
                  This deletes the saved documentation once you save — it
                  cannot be recovered afterward.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => {
                    updateCompetition({ content: null });
                    setResetKey((k) => k + 1);
                  }}
                >
                  Clear
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <Suspense fallback={null}>
        <div className="rounded-lg border">
          <ForwardRefEditor
            key={resetKey}
            markdown={competition.content ?? ""}
            placeholder="No documentation yet. Start typing to add some."
            onChange={(markdown) => updateCompetition({ content: markdown })}
          />
        </div>
      </Suspense>
    </div>
  );
}
