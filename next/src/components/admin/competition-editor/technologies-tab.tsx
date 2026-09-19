"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Code2 } from "lucide-react";

import { Label } from "@/components/ui/label";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  useComboboxAnchor,
} from "@/components/ui/combobox";
import { ApiError } from "@/lib/http";
import { TechnologyApi } from "@/modules/technologies/api/technology-api";
import type { TechnologyCatalogDTO } from "@/modules/technologies/backend/dto/technology-catalog.dto";
import { CompetitionTechnologyApi } from "@/modules/competitions/api/competition-technology-api";
import { useCompetitionEditorStore } from "@/modules/competitions/store/editor-store";
import { TabCompletenessFooter } from "./tab-completeness-footer";
import { useScrollToFocusedField } from "./use-scroll-to-focused-field";

export function TechnologiesTab() {
  useScrollToFocusedField();

  const competition = useCompetitionEditorStore((state) => state.competition);

  const setTechnologies = useCompetitionEditorStore(
    (state) => state.setTechnologies,
  );

  const [catalog, setCatalog] = useState<TechnologyCatalogDTO[]>([]);

  const [busy, setBusy] = useState(false);

  const anchor = useComboboxAnchor();

  useEffect(() => {
    let cancelled = false;

    TechnologyApi.getCatalog()
      .then((items) => {
        if (!cancelled) {
          setCatalog(items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          toast.error("Failed to load the technology catalog.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const technologies = useMemo(
    () => competition?.technologies ?? [],
    [competition],
  );

  const attachedIds = useMemo(
    () => new Set(technologies.map((technology) => technology.id)),
    [technologies],
  );

  // The Combobox's `value` must be drawn from `items` (the catalog) rather
  // than `competition.technologies` directly: `isItemEqualToValue` compares
  // by id, but keeping both lists sourced from the same catalog array keeps
  // referential membership unambiguous while the catalog is still loading.
  const selectedItems = useMemo(
    () => catalog.filter((technology) => attachedIds.has(technology.id)),
    [catalog, attachedIds],
  );

  if (!competition) {
    return null;
  }

  const canManage = competition.permissions.canManageTechnologies;

  async function run(
    action: () => Promise<Awaited<ReturnType<typeof CompetitionTechnologyApi.attach>>>,
    successMessage: string,
  ) {
    try {
      setBusy(true);

      setTechnologies(await action());

      toast.success(successMessage);
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.message);
      } else {
        toast.error("Unexpected error");
      }
    } finally {
      setBusy(false);
    }
  }

  function handleValueChange(next: TechnologyCatalogDTO[]) {
    const nextIds = new Set(next.map((t) => t.id));

    const added = next.filter((t) => !attachedIds.has(t.id));
    const removed = technologies.filter((t) => !nextIds.has(t.id));

    for (const technology of added) {
      void run(
        () => CompetitionTechnologyApi.attach(competition!.id, technology.id),
        `${technology.name} added.`,
      );
    }

    for (const technology of removed) {
      void run(
        () => CompetitionTechnologyApi.detach(competition!.id, technology.id),
        `${technology.name} removed.`,
      );
    }
  }

  return (
    <div id="field-technologies" className="grid gap-6 pt-6">
      {canManage ? (
        <div className="space-y-2">
          <Label>Technologies</Label>

          <Combobox
            multiple
            items={catalog}
            value={selectedItems}
            onValueChange={handleValueChange}
            itemToStringLabel={(t) => t.name}
            isItemEqualToValue={(a, b) => a.id === b.id}
          >
            <ComboboxChips ref={anchor} className={busy ? "opacity-60" : ""}>
              {selectedItems.map((technology) => (
                <ComboboxChip key={technology.id}>
                  {technology.iconAsset ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={technology.iconAsset.secureUrl}
                      alt=""
                      className="size-3.5 object-contain"
                    />
                  ) : null}
                  {technology.name}
                </ComboboxChip>
              ))}
              <ComboboxChipsInput
                placeholder={
                  selectedItems.length === 0 ? "Add technology..." : ""
                }
                disabled={busy}
              />
            </ComboboxChips>

            <ComboboxContent anchor={anchor}>
              <ComboboxList>
                <ComboboxEmpty>
                  {catalog.length === 0
                    ? "Loading…"
                    : "No matching technologies."}
                </ComboboxEmpty>
                <ComboboxCollection>
                  {(technology: TechnologyCatalogDTO) => (
                    <ComboboxItem key={technology.id} value={technology}>
                      {technology.name}
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxList>
            </ComboboxContent>
          </Combobox>

          <p className="text-xs text-muted-foreground">
            Technologies relevant to this competition — for discovery and
            display, not a requirement contestants must use.
          </p>
        </div>
      ) : technologies.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <Code2 className="mx-auto mb-2 h-6 w-6" />
          No technologies yet.
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {technologies.map((technology) => (
            <div
              key={technology.id}
              className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm"
            >
              {technology.iconAsset ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={technology.iconAsset.secureUrl}
                  alt=""
                  className="h-4 w-4 object-contain"
                />
              ) : null}
              <span>{technology.name}</span>
            </div>
          ))}
        </div>
      )}

      <TabCompletenessFooter tab="technologies" />
    </div>
  );
}
