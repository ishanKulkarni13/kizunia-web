"use client";

import { useEffect } from "react";

import { ProjectEditorHeader } from "./project-editor-header";
import { ProjectEditorNavigation } from "./project-editor-navigation";

import { useProjectStore } from "../../store/project.store";

interface ProjectEditorLayoutProps {
  projectId: string;
  children: React.ReactNode;
}

export function ProjectEditorLayout({
  projectId,
  children,
}: ProjectEditorLayoutProps) {
  const project = useProjectStore((state) => state.project);
  const isLoading = useProjectStore((state) => state.isLoading);
  const error = useProjectStore((state) => state.error);
  const getProject = useProjectStore((state) => state.getProject);

  useEffect(() => {
    void getProject({
      id: projectId,
    });
  }, [projectId, getProject]);

  if (isLoading) {
    return (
      <div className="flex min-h-full flex-col">
        <div className="space-y-6">
          <div className="h-8 w-64 animate-pulse rounded-md bg-muted" />
          <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
          <div className="h-64 w-full animate-pulse rounded-md bg-muted" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="max-w-md space-y-2 text-center">
          <h2 className="text-lg font-semibold">
            Unable to load project
          </h2>

          <p className="text-sm text-muted-foreground">
            {error}
          </p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="max-w-md space-y-2 text-center">
          <h2 className="text-lg font-semibold">
            Project not found
          </h2>

          <p className="text-sm text-muted-foreground">
            The project could not be loaded.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full w-full flex-col md:mx-auto md:w-fit md:min-w-2xl">
      <div className="space-y-4">
        <ProjectEditorHeader projectName={project.title} />

        <ProjectEditorNavigation projectId={project.id} />

        <main className="" >{children}</main>
      </div>
    </div>
  );
}