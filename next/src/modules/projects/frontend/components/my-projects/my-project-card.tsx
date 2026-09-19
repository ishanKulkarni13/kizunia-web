import Link from "next/link";
import { formatDistanceToNow } from "date-fns";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getInitials } from "@/utils/utils";
import type { ProjectRole, ProjectStatus, ProjectVisibility } from "@/generated/prisma";
import { ProjectMineSummaryDto } from "../../../backend/dto/output";

const STATUS_LABEL: Record<ProjectStatus, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
};

const STATUS_TONE: Record<ProjectStatus, string> = {
  DRAFT: "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300",
  PUBLISHED:
    "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};

const VISIBILITY_LABEL: Record<ProjectVisibility, string> = {
  PUBLIC: "Public",
  UNLISTED: "Unlisted",
  PRIVATE: "Private",
};

const ROLE_LABEL: Record<ProjectRole, string> = {
  OWNER: "Owner",
  MAINTAINER: "Maintainer",
  CONTRIBUTOR: "Contributor",
};

export function MyProjectCard({
  project,
}: {
  project: ProjectMineSummaryDto;
}) {
  const description = project.shortDescription.trim() || null;

  return (
    <Card className="group/card relative flex-row overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-xl has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring">
      <div className="flex flex-1 flex-col">
        <CardHeader className="gap-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <Link
                href={`/projects/${project.slug}`}
                className="after:absolute after:inset-0 focus-visible:outline-none"
              >
                <h3 className="line-clamp-1 font-heading text-lg font-semibold group-hover/card:text-primary">
                  {project.title}
                </h3>
              </Link>

              <p className="text-sm text-muted-foreground">
                Updated{" "}
                {formatDistanceToNow(project.updatedAt, { addSuffix: true })}
              </p>
            </div>

            <Avatar className="h-12 w-12 shrink-0">
              <AvatarImage src={project.logo?.url} alt={project.title} />
              <AvatarFallback>{getInitials(project.title)}</AvatarFallback>
            </Avatar>
          </div>

          {description && (
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </CardHeader>

        <CardContent className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={cn(STATUS_TONE[project.status])}>
              {STATUS_LABEL[project.status]}
            </Badge>

            <Badge variant="outline">{VISIBILITY_LABEL[project.visibility]}</Badge>

            <Badge variant="secondary">{ROLE_LABEL[project.myRole]}</Badge>
          </div>

          <div className="relative z-10 flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/projects/${project.slug}`}>Open</Link>
            </Button>

            {project.canEdit && (
              <Button asChild size="sm">
                <Link href={`/projects/${project.id}/edit`}>Edit</Link>
              </Button>
            )}
          </div>
        </CardContent>
      </div>
    </Card>
  );
}
