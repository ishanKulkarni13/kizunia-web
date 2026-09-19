"use client";

import { useEffect } from "react";
import { FolderGit2 } from "lucide-react";

import { usePortfolioStore } from "../../../store/portfolio.store";
import { usePortfolioProjectsStore } from "../../../store/portfolio-projects.store";
import { AddProjectDialog } from "./add-project-dialog";
import { PortfolioProjectCard } from "./portfolio-project-card";

export function PortfolioProjectsSection() {
  const portfolio = usePortfolioStore((state) => state.portfolio);

  const projects = usePortfolioProjectsStore((state) => state.projects);
  const isLoading = usePortfolioProjectsStore((state) => state.isLoading);
  const busy = usePortfolioProjectsStore((state) => state.busy);
  const error = usePortfolioProjectsStore((state) => state.error);
  const initialize = usePortfolioProjectsStore((state) => state.initialize);
  const addProject = usePortfolioProjectsStore((state) => state.addProject);
  const removeProject = usePortfolioProjectsStore(
    (state) => state.removeProject,
  );
  const setFeatured = usePortfolioProjectsStore((state) => state.setFeatured);
  const reorderProjects = usePortfolioProjectsStore(
    (state) => state.reorderProjects,
  );

  useEffect(() => {
    if (!portfolio) {
      return;
    }

    void initialize({ portfolioId: portfolio.id });
  }, [portfolio, initialize]);

  if (!portfolio) {
    return (
      <div className="rounded-lg border p-6">
        <p className="text-sm text-muted-foreground">
          Portfolio data is unavailable.
        </p>
      </div>
    );
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;

    if (target < 0 || target >= projects.length) {
      return;
    }

    const ids = projects.map((project) => project.projectId);

    [ids[index], ids[target]] = [ids[target], ids[index]];

    void reorderProjects(ids);
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Projects</h2>

          <p className="text-sm text-muted-foreground">
            Showcase projects you&apos;re a member of. Adding a project here
            only manages its place on your portfolio — it doesn&apos;t change
            the project itself.
          </p>
        </div>

        <AddProjectDialog
          excludedProjectIds={projects.map((project) => project.projectId)}
          busy={busy}
          onAdd={async (projectId) => {
            await addProject({ projectId });
          }}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((key) => (
            <div key={key} className="h-20 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <FolderGit2 className="mx-auto mb-2 h-6 w-6" />
          No projects added yet.
          <br />
          Add a project you&apos;re a member of to showcase it in your
          portfolio.
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map((project, index) => (
            <PortfolioProjectCard
              key={project.projectId}
              project={project}
              busy={busy}
              canMoveUp={index > 0}
              canMoveDown={index < projects.length - 1}
              onMoveUp={() => move(index, -1)}
              onMoveDown={() => move(index, 1)}
              onToggleFeatured={() =>
                void setFeatured(project.projectId, {
                  featured: !project.featured,
                })
              }
              onRemove={() => void removeProject(project.projectId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
