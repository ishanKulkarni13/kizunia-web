"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { UserCheck } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/http";
import type { EligibilityType } from "@/generated/prisma";
import { ELIGIBILITY_OPTIONS } from "@/modules/competitions/constants";
import { CompetitionEligibilityApi } from "@/modules/competitions/api/competition-eligibility-api";
import type { CompetitionEligibilityDTO } from "@/modules/competitions/types/competition-eligibility.dto";
import { useCompetitionEditorStore } from "@/modules/competitions/store/editor-store";
import { TabCompletenessFooter } from "./tab-completeness-footer";
import { useScrollToFocusedField } from "./use-scroll-to-focused-field";

/**
 * `CompetitionEligibility` has no external catalog the way Technologies
 * does — its options are the fixed `EligibilityType` enum, so this renders
 * a static checkbox grid rather than a combobox over a fetched list.
 */
export function EligibilityTab() {
  useScrollToFocusedField();

  const competition = useCompetitionEditorStore((state) => state.competition);

  const setEligibilities = useCompetitionEditorStore(
    (state) => state.setEligibilities,
  );

  const [busy, setBusy] = useState(false);

  const eligibilities = useMemo(
    () => competition?.eligibilities ?? [],
    [competition],
  );

  const selectedTypes = useMemo(
    () => new Set(eligibilities.map((eligibility) => eligibility.type)),
    [eligibilities],
  );

  if (!competition) {
    return null;
  }

  const canManage = competition.permissions.canManageEligibility;

  async function run(
    action: () => Promise<CompetitionEligibilityDTO[]>,
    successMessage: string,
  ) {
    try {
      setBusy(true);

      setEligibilities(await action());

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

  function toggle(type: EligibilityType, label: string) {
    if (selectedTypes.has(type)) {
      void run(
        () => CompetitionEligibilityApi.detach(competition!.id, type),
        `${label} removed.`,
      );
    } else {
      void run(
        () => CompetitionEligibilityApi.attach(competition!.id, type),
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

      let latest: CompetitionEligibilityDTO[] = eligibilities;

      for (const type of selectedTypes) {
        latest = await CompetitionEligibilityApi.detach(competition!.id, type);
      }

      setEligibilities(latest);

      toast.success("Eligibility cleared.");
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
    <div id="field-eligibilities" className="grid gap-6 pt-6">
      {canManage ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Eligibility</Label>

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
            {ELIGIBILITY_OPTIONS.map((option) => {
              const id = `eligibility-${option.value}`;
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
            Who this competition is open to. Select every group that
            applies — selecting nothing leaves eligibility unspecified rather
            than open to everyone.
          </p>
        </div>
      ) : eligibilities.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <UserCheck className="mx-auto mb-2 h-6 w-6" />
          No eligibility set yet.
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {eligibilities.map((eligibility) => (
            <div
              key={eligibility.type}
              className="rounded-full border px-3 py-1.5 text-sm"
            >
              {ELIGIBILITY_OPTIONS.find((o) => o.value === eligibility.type)
                ?.label ?? eligibility.type}
            </div>
          ))}
        </div>
      )}

      <TabCompletenessFooter tab="eligibility" />
    </div>
  );
}
