import Image from "next/image";
import Link from "next/link";
import { PencilIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ProjectPublicDetailsDto } from "@/modules/projects/backend/dto/output";

import { ProjectShareButton } from "./project-share-button";

interface ProjectViewHeaderProps {
  project: ProjectPublicDetailsDto;
}

export function ProjectViewHeader({ project }: ProjectViewHeaderProps) {
  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl border">
        {project.logo ? (
          <Image
            src={project.logo.url}
            alt={`${project.title} logo`}
            fill
            sizes="96px"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted text-3xl font-bold">
            {project.title[0]}
          </div>
        )}
      </div>

      <div className="flex-1 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-4xl font-bold">{project.title}</h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Status is only meaningful to members — every viewer who
                isn't a member is guaranteed to be looking at a PUBLISHED
                project, so surfacing the badge to them would be redundant. */}
            {project.isMember && (
              <Badge variant={project.status === "PUBLISHED" ? "default" : "secondary"}>
                {project.status}
              </Badge>
            )}

            <ProjectShareButton slug={project.slug} title={project.title} />

            {project.permissions.canEdit && (
              <Button asChild size="sm">
                <Link href={`/projects/${project.id}/edit`}>
                  <PencilIcon />
                  Edit Project
                </Link>
              </Button>
            )}
          </div>
        </div>

        {project.shortDescription && (
          <p className="text-muted-foreground">{project.shortDescription}</p>
        )}

        {(project.categories.length > 0 || project.technologies.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {project.categories.map((category) => (
              <Badge key={category.id} variant="secondary">
                {category.name}
              </Badge>
            ))}

            {project.technologies.map((technology) => (
              <Badge key={technology.id} variant="outline">
                {technology.name}
              </Badge>
            ))}
          </div>
        )}

        {project.isMember && (
          <div>
            <Button asChild variant="link" className="h-auto p-0">
              <Link href="/projects/my-projects">Back to My Projects</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
