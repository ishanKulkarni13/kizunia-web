import type { ProjectSummaryDto } from "../../../backend/dto/output";
import { ProjectCard } from "./project-card";

/**
 * One row per project, height driven by whatever that project actually
 * has — mirrors `CompetitionsCards`. See that component's doc comment for
 * the fuller rationale.
 */
export function ProjectCards({
  projects,
}: {
  projects: ProjectSummaryDto[];
}) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  );
}
