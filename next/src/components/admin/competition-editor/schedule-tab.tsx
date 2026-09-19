"use client";

/**
 * Admin Competition Editor - Schedule tab
 *
 * Every field here is a lifecycle date or the automation flag. Saving from
 * this tab goes through the same `PATCH /admin/competitions/[id]` every
 * other tab uses (via `useCompetitionEditorStore.save`) — the backend
 * decides whether these edits should move `status`, and this tab only ever
 * displays what the backend last returned; it never computes a status
 * itself. See `CompetitionService.update` for the reconciliation this
 * triggers, and `CompetitionEditorStore.save` for how the response is
 * adopted so a recalculated status appears here without a page refresh.
 */

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useCompetitionEditorStore } from "@/modules/competitions/store/editor-store";
import { StatusBadge } from "@/modules/competitions/components/status-badge";
import { DateTimePicker } from "./datetime-picker";
import { EditorField } from "./editor-field";
import { TabCompletenessFooter } from "./tab-completeness-footer";
import { useFieldStatus } from "./use-field-status";
import { useScrollToFocusedField } from "./use-scroll-to-focused-field";

function formatUpdatedAt(iso: string | null): string {
  if (!iso) return "Never";

  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ScheduleTab() {
  useScrollToFocusedField();

  const competition = useCompetitionEditorStore((state) => state.competition);
  const updateCompetition = useCompetitionEditorStore(
    (state) => state.updateCompetition,
  );

  const registrationStartDateStatus = useFieldStatus("registrationStartDate");
  const registrationDeadlineStatus = useFieldStatus("registrationDeadline");
  const startDateStatus = useFieldStatus("startDate");
  const endDateStatus = useFieldStatus("endDate");

  if (!competition) {
    return null;
  }

  return (
    <div className="grid gap-6 pt-6">
      <div className="rounded-md border bg-muted/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Label>Current status</Label>
            <div className="mt-1.5 flex items-center gap-2">
              <StatusBadge status={competition.status} />
              <span className="text-xs text-muted-foreground">
                Last changed {formatUpdatedAt(competition.statusUpdatedAt)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <Label htmlFor="automation-toggle">
                Automatic status updates
              </Label>
              <p className="text-xs text-muted-foreground">
                {competition.automaticStatusUpdatesDisabled
                  ? "Off — status changes below and the nightly sweep are both ignored. The manual status dropdown still works."
                  : "On — status is derived from the dates below and updates automatically."}
              </p>
            </div>
            <Switch
              id="automation-toggle"
              checked={!competition.automaticStatusUpdatesDisabled}
              onCheckedChange={(checked) =>
                updateCompetition({
                  automaticStatusUpdatesDisabled: !checked,
                })
              }
            />
          </div>
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <EditorField
          label="Registration opens"
          htmlFor="registrationStartDate"
          fieldKey="registrationStartDate"
          status={registrationStartDateStatus}
          description={
            <p className="text-xs text-muted-foreground">
              Leave blank if registration opening is not automated — it will
              not become REGISTRATION_OPEN on its own.
            </p>
          }
        >
          <DateTimePicker
            id="registrationStartDate"
            value={competition.registrationStartDate}
            onCommit={(iso) =>
              updateCompetition({ registrationStartDate: iso })
            }
          />
        </EditorField>

        <EditorField
          label="Registration deadline"
          htmlFor="registrationDeadline"
          fieldKey="registrationDeadline"
          status={registrationDeadlineStatus}
          description={
            <p className="text-xs text-muted-foreground">
              Can be after the start date — registration then stays open
              while the competition is already ONGOING.
            </p>
          }
        >
          <DateTimePicker
            id="registrationDeadline"
            value={competition.registrationDeadline}
            onCommit={(iso) => updateCompetition({ registrationDeadline: iso })}
          />
        </EditorField>

        <EditorField
          label="Starts"
          htmlFor="startDate"
          fieldKey="startDate"
          status={startDateStatus}
        >
          <DateTimePicker
            id="startDate"
            value={competition.startDate}
            onCommit={(iso) => updateCompetition({ startDate: iso })}
          />
        </EditorField>

        <EditorField label="Ends" htmlFor="endDate" fieldKey="endDate" status={endDateStatus}>
          <DateTimePicker
            id="endDate"
            value={competition.endDate}
            onCommit={(iso) => updateCompetition({ endDate: iso })}
          />
        </EditorField>
      </div>

      <TabCompletenessFooter tab="schedule" />
    </div>
  );
}
