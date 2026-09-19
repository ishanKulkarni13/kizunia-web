import Link from "next/link";
import { format } from "date-fns";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getInitials } from "@/utils/utils";
import type { ProjectStatus } from "@/generated/prisma";
import type { ProjectSummaryDto } from "../../../backend/dto/output";

const STATUS_LABEL: Record<ProjectStatus, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
};

const STATUS_TONE: Record<ProjectStatus, string> = {
  DRAFT: "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300",
  PUBLISHED:
    "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};

/**
 * One row of the public `/projects` listing.
 *
 * Deliberately its own component rather than a reuse of `MyProjectCard`:
 * that card renders `ProjectMineSummaryDto` (membership role, an Edit
 * action, an "Updated ⟨relative time⟩" line) which has no place on a public
 * row, and this one renders category/technology tags and a date range that
 * `MyProjectCard` has no data for. The two share a visual language, not a
 * component.
 */
export function ProjectCard({ project }: { project: ProjectSummaryDto }) {
  const description = project.shortDescription.trim() || null;
  const dateRange = formatDateRange(project.startDate, project.endDate);

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

              {dateRange && (
                <p className="text-sm text-muted-foreground">{dateRange}</p>
              )}
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

        {(project.categories.length > 0 ||
          project.technologies.length > 0) && (
          <CardContent className="mt-1 flex flex-wrap items-center gap-2 border-t pt-3">
            <Badge className={cn(STATUS_TONE[project.status])}>
              {STATUS_LABEL[project.status]}
            </Badge>

            {project.categories.map((category) => (
              <Badge key={category.slug} variant="outline">
                {category.name}
              </Badge>
            ))}

            {project.technologies.map((technology) => (
              <Badge key={technology.slug} variant="secondary">
                {technology.name}
              </Badge>
            ))}
          </CardContent>
        )}
      </div>
    </Card>
  );
}

function formatDateRange(
  startDate: Date | null,
  endDate: Date | null,
): string | null {
  if (!startDate && !endDate) {
    return null;
  }

  if (startDate && endDate) {
    return `${format(startDate, "MMM yyyy")} – ${format(endDate, "MMM yyyy")}`;
  }

  if (startDate) {
    return `Started ${format(startDate, "MMM yyyy")}`;
  }

  return `Until ${format(endDate as Date, "MMM yyyy")}`;
}
