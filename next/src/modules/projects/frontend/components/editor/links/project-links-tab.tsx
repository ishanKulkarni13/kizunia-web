"use client";

import { useEffect } from "react";
import { ArrowDown, ArrowUp, Link2, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LINK_TYPE_META } from "@/modules/links";

import { useProjectStore } from "../../../store/project.store";
import { useProjectLinksStore } from "../../../store/project-links.store";
import { LinkFormDialog, type LinkFormValues } from "./link-form-dialog";

interface ProjectLinksTabProps {
  projectId: string;
}

export function ProjectLinksTab({ projectId }: ProjectLinksTabProps) {
  const project = useProjectStore((state) => state.project);

  const links = useProjectLinksStore((state) => state.links);

  const busy = useProjectLinksStore((state) => state.busy);

  const initialize = useProjectLinksStore((state) => state.initialize);

  const createLink = useProjectLinksStore((state) => state.createLink);

  const updateLink = useProjectLinksStore((state) => state.updateLink);

  const deleteLink = useProjectLinksStore((state) => state.deleteLink);

  const reorderLinks = useProjectLinksStore((state) => state.reorderLinks);

  useEffect(() => {
    if (!project) {
      return;
    }

    initialize({ projectId: project.id, links: project.links });
  }, [project, initialize]);

  if (!project) {
    return (
      <div className="rounded-lg border p-6">
        <p className="text-sm text-muted-foreground">
          Project data is unavailable.
        </p>
      </div>
    );
  }

  const canManageLinks = project.permissions.canManageLinks;

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;

    if (target < 0 || target >= links.length) {
      return;
    }

    const ids = links.map((link) => link.id);

    [ids[index], ids[target]] = [ids[target], ids[index]];

    void reorderLinks({ projectId, ids });
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Links</h2>

          <p className="text-sm text-muted-foreground">
            Manage external links shown on this project — repositories, demos,
            documentation, and more.
          </p>
        </div>

        {canManageLinks && (
          <LinkFormDialog
            busy={busy}
            trigger={
              <Button type="button" size="sm">
                <Plus />
                Add link
              </Button>
            }
            onSubmit={async (values: LinkFormValues) => {
              await createLink({ projectId, dto: values });
            }}
          />
        )}
      </div>

      {!canManageLinks && (
        <div className="rounded-md border border-border bg-muted/50 p-3">
          <p className="text-sm text-muted-foreground">
            You have view-only access to this project&apos;s links.
          </p>
        </div>
      )}

      {links.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <Link2 className="mx-auto mb-2 h-6 w-6" />
          No links yet.
        </div>
      ) : (
        <div className="space-y-3">
          {links.map((link, index) => {
            const meta = LINK_TYPE_META[link.type];
            const Icon = meta.icon;

            return (
              <div
                key={link.id}
                className="flex items-center gap-3 rounded-lg border p-3"
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

                {canManageLinks && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busy || index === 0}
                      onClick={() => move(index, -1)}
                      aria-label="Move link up"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busy || index === links.length - 1}
                      onClick={() => move(index, 1)}
                      aria-label="Move link down"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>

                    <LinkFormDialog
                      link={link}
                      busy={busy}
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={busy}
                          aria-label="Edit link"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      }
                      onSubmit={async (values: LinkFormValues) => {
                        await updateLink({
                          projectId,
                          linkId: link.id,
                          dto: values,
                        });
                      }}
                    />

                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      onClick={() => void deleteLink({ projectId, linkId: link.id })}
                      aria-label="Remove link"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
