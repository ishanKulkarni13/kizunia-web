"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Tag } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/http";
import type { CompetitionType } from "@/generated/prisma";
import { COMPETITION_TYPE_OPTIONS } from "@/modules/competitions/constants";
import { CompetitionTypeApi } from "@/modules/competitions/api/competition-type-api";
import type { CompetitionTypeDTO } from "@/modules/competitions/types/competition-type.dto";
import { useCompetitionEditorStore } from "@/modules/competitions/store/editor-store";
import { TabCompletenessFooter } from "./tab-completeness-footer";
import { useScrollToFocusedField } from "./use-scroll-to-focused-field";

/**
 * `CompetitionTypeRelation` has no external catalog the way Technologies
 * does -- its options are the fixed `CompetitionType` enum, so this renders
 * a static checkbox grid rather than a combobox over a fetched list.
 *
 * Multiple types are OR-combined at query time: selecting HACKATHON + CTF
 * means "show me hackathons or CTF competitions". Selecting nothing leaves
 * the competition unclassified -- zero types is a valid, intentional state.
 */
export function TypesTab() {
  useScrollToFocusedField();

  const competition = useCompetitionEditorStore((state) => state.competition);

  const setTypes = useCompetitionEditorStore((state) => state.setTypes);

  const [busy, setBusy] = useState(false);

  const types = useMemo(
    () => competition?.types ?? [],
    [competition],
  );

  const selectedTypes = useMemo(
    () => new Set(types.map((t) => t.type)),
    [types],
  );

  if (!competition) {
    return null;
  }

  const canManage = competition.permissions.canManageTypes;

  async function run(
    action: () => Promise<CompetitionTypeDTO[]>,
    successMessage: string,
  ) {
    try {
      setBusy(true);

      setTypes(await action());

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

  function toggle(type: CompetitionType, label: string) {
    if (selectedTypes.has(type)) {
      void run(
        () => CompetitionTypeApi.detach(competition!.id, type),
        `${label} removed.`,
      );
    } else {
      void run(
        () => CompetitionTypeApi.attach(competition!.id, type),
        `${label} added.`,
      );
    }
  }

  async function clearAll() {
    if (selectedTypes.size === 0) {
      return;
    }

    try {
      setBusy(true);

      let latest: CompetitionTypeDTO[] = types;

      for (const type of selectedTypes) {
        latest = await CompetitionTypeApi.detach(competition!.id, type);
      }

      setTypes(latest);

      toast.success("Types cleared.");
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

  return (
    <div id="field-types" className="grid gap-6 pt-6">
      {canManage ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Type</Label>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy || selectedTypes.size === 0}
              onClick={() => void clearAll()}
            >
              Clear all
            </Button>
          </div>

          <div
            className={
              "grid grid-cols-1 gap-2 sm:grid-cols-2" +
              (busy ? " opacity-60" : "")
            }
          >
            {COMPETITION_TYPE_OPTIONS.map((option) => {
              const id = `type-${option.value}`;
              const isSelected = selectedTypes.has(option.value);

              return (
                <div
                  key={option.value}
                  className="flex items-center gap-2.5 rounded-md border px-3 py-2"
                >
                  <Checkbox
                    id={id}
                    checked={isSelected}
                    disabled={busy}
                    onCheckedChange={() => toggle(option.value, option.label)}
                  />

                  <Label
                    htmlFor={id}
                    className="flex-1 cursor-pointer text-sm font-normal"
                  >
                    {option.label}
                  </Label>
                </div>
              );
            })}
          </div>

          <p className="text-xs text-muted-foreground">
            The fundamental nature of this competition. Select every type that
            applies -- selecting nothing leaves it unclassified rather than
            excluding it from search.
          </p>
        </div>
      ) : types.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <Tag className="mx-auto mb-2 h-6 w-6" />
          No types set yet.
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {types.map((t) => (
            <div
              key={t.type}
              className="rounded-full border px-3 py-1.5 text-sm"
            >
              {COMPETITION_TYPE_OPTIONS.find((o) => o.value === t.type)
                ?.label ?? t.type}
            </div>
          ))}
        </div>
      )}

      <TabCompletenessFooter tab="types" />
    </div>
  );
}
