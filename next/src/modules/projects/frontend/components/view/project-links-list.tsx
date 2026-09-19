import Link from "next/link";
import { Link2, SquareArrowOutUpRight } from "lucide-react";

import { LINK_TYPE_META } from "@/modules/links";
import type { ProjectLinkDto } from "@/modules/projects/backend/dto/output";

interface ProjectLinksListProps {
  links: ProjectLinkDto[];
}

/**
 * Read-only rendering of a project's links, adapted from the editor's
 * `ProjectLinksTab` with every `canManageLinks` affordance stripped.
 */
export function ProjectLinksList({ links }: ProjectLinksListProps) {
  if (links.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        <Link2 className="mx-auto mb-2 h-6 w-6" />
        No links yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {links.map((link) => {
        const meta = LINK_TYPE_META[link.type];
        const Icon = meta.icon;

        return (
          <Link
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
              <Icon className="size-4" />
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{link.title}</p>

              <p className="truncate text-xs text-muted-foreground">
                {meta.label} · {link.url}
              </p>
            </div>

            <SquareArrowOutUpRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        );
      })}
    </div>
  );
}
