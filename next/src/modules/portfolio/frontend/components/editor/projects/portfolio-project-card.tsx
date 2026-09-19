import { ArrowDown, ArrowUp, Star, Trash2 } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getInitials } from "@/utils/utils";
import type {
  ProjectRole,
  ProjectStatus,
  ProjectVisibility,
} from "@/generated/prisma";

import type { PortfolioProjectSummaryDto } from "../../../../dtos";
import { RemoveProjectConfirm } from "./remove-project-confirm";

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

/**
 * A project's visibility on the public portfolio, independent of the
 * editor's own membership-based visibility rule (see the repository header
 * comment for the distinction).
 */
function isPubliclyRenderable(project: PortfolioProjectSummaryDto): boolean {
  return project.status === "PUBLISHED" && project.visibility === "PUBLIC";
}

interface PortfolioProjectCardProps {
  project: PortfolioProjectSummaryDto;

  busy: boolean;

  canMoveUp: boolean;

  canMoveDown: boolean;

  onMoveUp: () => void;

  onMoveDown: () => void;

  onToggleFeatured: () => void;

  onRemove: () => void;
}

export function PortfolioProjectCard({
  project,
  busy,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onToggleFeatured,
  onRemove,
}: PortfolioProjectCardProps) {
  const isPublic = isPubliclyRenderable(project);

  const description = project.shortDescription.trim() || null;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center",
        project.featured && "border-primary/40 bg-primary/[0.03]",
      )}
    >
      <Avatar className={cn("size-9 shrink-0", !isPublic && "opacity-70")}>
        <AvatarImage src={project.logo?.url} alt={project.title} />
        <AvatarFallback>{getInitials(project.title)}</AvatarFallback>
      </Avatar>

      <div className={cn("min-w-0 flex-1", !isPublic && "opacity-70")}>
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate font-medium">{project.title}</p>

          {project.featured && (
            <Badge className="border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300">
              <Star className="size-3" />
              Featured
            </Badge>
          )}
        </div>

        {description && (
          <p className="truncate text-xs text-muted-foreground">
            {description}
          </p>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge className={cn(STATUS_TONE[project.status])}>
            {STATUS_LABEL[project.status]}
          </Badge>

          <Badge variant="outline">
            {VISIBILITY_LABEL[project.visibility]}
          </Badge>

          <Badge variant="secondary">{ROLE_LABEL[project.myRole]}</Badge>
        </div>

        {!isPublic && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Won&apos;t appear on your public portfolio until it&apos;s
            published and public.
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap gap-1">
        <Button
          variant="ghost"
          size="icon"
          disabled={busy || !canMoveUp}
          onClick={onMoveUp}
          aria-label="Move project up"
        >
          <ArrowUp className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          disabled={busy || !canMoveDown}
          onClick={onMoveDown}
          aria-label="Move project down"
        >
          <ArrowDown className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          disabled={busy}
          onClick={onToggleFeatured}
          aria-label={
            project.featured ? "Unfeature project" : "Feature project"
          }
        >
          <Star
            className={cn(
              "h-4 w-4",
              project.featured && "fill-amber-500 text-amber-500",
            )}
          />
        </Button>

        <RemoveProjectConfirm
          projectTitle={project.title}
          busy={busy}
          onConfirm={onRemove}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              disabled={busy}
              aria-label="Remove project from portfolio"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          }
        />
      </div>
    </div>
  );
}
