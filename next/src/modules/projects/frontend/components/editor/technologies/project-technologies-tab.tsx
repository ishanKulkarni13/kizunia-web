"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Cpu, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TechnologyApi } from "@/modules/technologies/api/technology-api";
import type { TechnologyCatalogDTO } from "@/modules/technologies/backend/dto/technology-catalog.dto";

import { useProjectStore } from "../../../store/project.store";
import { useProjectTechnologiesStore } from "../../../store/project-technologies.store";

interface ProjectTechnologiesTabProps {
  projectId: string;
}

export function ProjectTechnologiesTab({
  projectId,
}: ProjectTechnologiesTabProps) {
  const project = useProjectStore((state) => state.project);

  const technologies = useProjectTechnologiesStore(
    (state) => state.technologies,
  );

  const busy = useProjectTechnologiesStore((state) => state.busy);

  const initialize = useProjectTechnologiesStore((state) => state.initialize);

  const attachTechnology = useProjectTechnologiesStore(
    (state) => state.attachTechnology,
  );

  const detachTechnology = useProjectTechnologiesStore(
    (state) => state.detachTechnology,
  );

  const reorderTechnologies = useProjectTechnologiesStore(
    (state) => state.reorderTechnologies,
  );

  const [catalog, setCatalog] = useState<TechnologyCatalogDTO[]>([]);

  const [selectedTechnologyId, setSelectedTechnologyId] = useState<string>("");

  useEffect(() => {
    void initialize({ projectId });
  }, [projectId, initialize]);

  useEffect(() => {
    let cancelled = false;

    void TechnologyApi.getCatalog().then((items) => {
      if (!cancelled) {
        setCatalog(items);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!project) {
    return (
      <div className="rounded-lg border p-6">
        <p className="text-sm text-muted-foreground">
          Project data is unavailable.
        </p>
      </div>
    );
  }

  const canManageTechnologies = project.permissions.canManageTechnologies;

  const attachedIds = new Set(technologies.map((technology) => technology.id));

  const availableTechnologies = catalog.filter(
    (technology) => !attachedIds.has(technology.id),
  );

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;

    if (target < 0 || target >= technologies.length) {
      return;
    }

    const ids = technologies.map((technology) => technology.id);

    [ids[index], ids[target]] = [ids[target], ids[index]];

    void reorderTechnologies({ projectId, ids });
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h2 className="text-lg font-semibold">Technologies</h2>

        <p className="text-sm text-muted-foreground">
          The stack actually used to build this project — shown on its public
          page and used for discovery filters.
        </p>
      </div>

      {!canManageTechnologies && (
        <div className="rounded-md border border-border bg-muted/50 p-3">
          <p className="text-sm text-muted-foreground">
            You have view-only access to this project&apos;s technologies.
          </p>
        </div>
      )}

      {canManageTechnologies && (
        <div className="flex items-center gap-2">
          <Select
            value={selectedTechnologyId}
            disabled={busy || availableTechnologies.length === 0}
            onValueChange={setSelectedTechnologyId}
          >
            <SelectTrigger className="w-full">
              <SelectValue
                placeholder={
                  availableTechnologies.length === 0
                    ? "All catalog technologies attached"
                    : "Select a technology to add"
                }
              />
            </SelectTrigger>

            <SelectContent>
              {availableTechnologies.map((technology) => (
                <SelectItem key={technology.id} value={technology.id}>
                  {technology.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            type="button"
            size="sm"
            disabled={busy || !selectedTechnologyId}
            onClick={async () => {
              if (!selectedTechnologyId) {
                return;
              }

              await attachTechnology({
                projectId,
                technologyId: selectedTechnologyId,
              });

              setSelectedTechnologyId("");
            }}
          >
            <Plus />
            Add
          </Button>
        </div>
      )}

      {technologies.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <Cpu className="mx-auto mb-2 h-6 w-6" />
          No technologies attached yet.
        </div>
      ) : (
        <div className="space-y-3">
          {technologies.map((technology, index) => (
            <div
              key={technology.id}
              className="flex items-center gap-3 rounded-lg border p-3"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted overflow-hidden">
                {technology.iconAsset ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={technology.iconAsset.url}
                    alt=""
                    className="size-5 object-contain"
                  />
                ) : (
                  <Cpu className="size-4" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{technology.name}</p>

                <p className="truncate text-xs text-muted-foreground">
                  {technology.type}
                </p>
              </div>

              {canManageTechnologies && (
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                    aria-label="Move technology up"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busy || index === technologies.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label="Move technology down"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    onClick={() =>
                      void detachTechnology({
                        projectId,
                        technologyId: technology.id,
                      })
                    }
                    aria-label="Remove technology"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
