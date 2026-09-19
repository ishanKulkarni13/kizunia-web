"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getInitials } from "@/utils/utils";
import { ApiError } from "@/lib/http";
import { ProjectApi } from "@/modules/projects/frontend/api/project-api";
import type { ProjectMineSummaryDto } from "@/modules/projects/backend/dto/output";

interface AddProjectDialogProps {
  /** Project ids already attached to the portfolio, so they can be excluded
   * from the picker — client-side presentation only. The server independently
   * rejects a duplicate via the relationship's composite primary key. */
  excludedProjectIds: string[];

  busy: boolean;

  onAdd: (projectId: string) => Promise<void>;
}

/**
 * Reuses `GET /api/v1/projects/mine` — the same membership-scoped listing
 * "My Projects" uses — rather than a new project-discovery endpoint. The
 * server re-checks membership on submit regardless of what this picker
 * shows; it is a convenience, never an authorization boundary.
 */
export function AddProjectDialog({
  excludedProjectIds,
  busy,
  onAdd,
}: AddProjectDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm">
          <Plus />
          Add project
        </Button>
      </DialogTrigger>

      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-md">
        {/* Mounted only while open, so search/page state always starts fresh
         * rather than being reset via an effect. */}
        {open && (
          <AddProjectDialogBody
            excludedProjectIds={excludedProjectIds}
            busy={busy}
            onAdd={async (projectId) => {
              await onAdd(projectId);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddProjectDialogBody({
  excludedProjectIds,
  busy,
  onAdd,
}: {
  excludedProjectIds: string[];
  busy: boolean;
  onAdd: (projectId: string) => Promise<void>;
}) {
  const [search, setSearch] = useState("");

  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [items, setItems] = useState<ProjectMineSummaryDto[]>([]);

  const [isLoading, setIsLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);

    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const result = await ProjectApi.findMine({
          search: debouncedSearch || undefined,
          page: 1,
          pageSize: 50,
          sortBy: "title",
          sortOrder: "asc",
        });

        if (!cancelled) {
          setItems(result.items);
          setIsLoading(false);
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(
            fetchError instanceof ApiError
              ? fetchError.message
              : "Failed to load your projects.",
          );
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [debouncedSearch]);

  const excluded = new Set(excludedProjectIds);

  const eligible = items.filter((project) => !excluded.has(project.id));

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a project</DialogTitle>

        <DialogDescription>
          Choose a project you&apos;re a member of to showcase it in your
          portfolio.
        </DialogDescription>
      </DialogHeader>

      <Input
        placeholder="Search your projects..."
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((key) => (
              <div key={key} className="h-14 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        ) : eligible.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {items.length === 0
              ? "You aren't a member of any projects yet."
              : "All your projects are already in your portfolio."}
          </p>
        ) : (
          <div className="space-y-2">
            {eligible.map((project) => (
              <div
                key={project.id}
                className="flex items-center gap-3 rounded-lg border p-3"
              >
                <Avatar className="size-9 shrink-0">
                  <AvatarImage src={project.logo?.url} alt={project.title} />
                  <AvatarFallback>{getInitials(project.title)}</AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{project.title}</p>

                  <p className="truncate text-xs text-muted-foreground">
                    {project.shortDescription}
                  </p>
                </div>

                <Badge variant="secondary" className="shrink-0">
                  {project.myRole}
                </Badge>

                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => void onAdd(project.id)}
                >
                  Add
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
