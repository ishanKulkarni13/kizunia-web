"use client";

import { Suspense, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { ForwardRefEditor } from "@/components/shared/mdx/ForwardRefEditor";

import { useProjectStore } from "../../../store/project.store";
import { useProjectContentStore } from "../../../store/project-content.store";

interface ProjectContentEditorProps {
  projectId: string;
}

export function ProjectContentEditor({
  projectId,
}: ProjectContentEditorProps) {
  const project = useProjectStore((state) => state.project);

  const content = useProjectContentStore(
    (state) => state.content,
  );

  const isSaving = useProjectContentStore(
    (state) => state.isSaving,
  );

  const isDirty = useProjectContentStore(
    (state) => state.isDirty(),
  );

  const error = useProjectContentStore(
    (state) => state.error,
  );

  const initialize = useProjectContentStore(
    (state) => state.initialize,
  );

  const setContent = useProjectContentStore(
    (state) => state.setContent,
  );

  const updateContent = useProjectContentStore(
    (state) => state.updateContent,
  );

  useEffect(() => {
    if (!project) {
      return;
    }

    initialize(project);
  }, [project, initialize]);

  useEffect(() => {
    if (!isDirty) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isDirty]);

  if (!project) {
    return (
      <section className="rounded-lg border p-6">
        <p className="text-sm text-muted-foreground">
          Project data is unavailable.
        </p>
      </section>
    );
  }

  const canManageContent = project.permissions.canManageContent;

  return (
    <section className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">
          Content
        </h2>

        <p className="text-sm text-muted-foreground">
          Write and manage the detailed content for your
          project.
        </p>
      </div>

      {!canManageContent && (
        <div className="rounded-md border border-border bg-muted/50 p-3">
          <p className="text-sm text-muted-foreground">
            You have view-only access to this project&apos;s
            content.
          </p>
        </div>
      )}

      <div className="rounded-lg border">
        <Suspense fallback={null}>
          <ForwardRefEditor
            markdown={content}
            onChange={(markdown) => setContent(markdown)}
            readOnly={!canManageContent}
            className=""
          />
        </Suspense>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm text-destructive">
            {error}
          </p>
        </div>
      )}

      {canManageContent && (
        <div className="flex justify-end">
          <Button
            disabled={isSaving || !isDirty}
            onClick={() =>
              void updateContent({
                id: projectId,
              })
            }
          >
            {isSaving ? "Saving..." : "Save content"}
          </Button>
        </div>
      )}
    </section>
  );
}
