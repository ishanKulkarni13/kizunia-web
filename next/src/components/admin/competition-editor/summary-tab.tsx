"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/modules/competitions/components/status-badge";
import { useCompetitionEditorStore } from "@/modules/competitions/store/editor-store";
import { useIsDirty } from "./use-field-status";
import { deriveFieldStatus } from "@/modules/competitions/editor/field-status";
import {
  FIELD_METADATA,
  type FieldImportance,
} from "@/modules/competitions/editor/field-metadata";
import type { CompetitionEditDTOWithPermissions } from "@/modules/competitions/types/edit-dto";

const IMPORTANCE_LABEL: Record<FieldImportance, string> = {
  critical: "Core information",
  important: "Recommended information",
  optional: "Optional information",
};

/**
 * The central overview: what's missing, grouped by how much it matters,
 * without ever implying that missing "important" or "optional" information
 * blocks anything. Only the "data-contract problems" section below can say
 * a save will fail — everything else here is guidance, not a gate.
 *
 * Deliberately runs no validation of its own: every row is derived from
 * `FIELD_METADATA` + `deriveFieldStatus`, the same functions the tabs and
 * their status badges already use.
 */
export function SummaryTab() {
  const competition = useCompetitionEditorStore((s) => s.competition);
  const original = useCompetitionEditorStore((s) => s.original);
  const fieldErrors = useCompetitionEditorStore((s) => s.fieldErrors);
  const isDirty = useIsDirty();

  if (!competition || !original) return null;

  const tabHref = (tab: string, key: string) =>
    `/admin/competitions/${competition.id}/${tab}?focus=${key}`;

  const rows = FIELD_METADATA.map((meta) => {
    const key = meta.key as keyof CompetitionEditDTOWithPermissions;
    const status = deriveFieldStatus(competition[key], original[key]);
    return { meta, status };
  });

  // Only a blank *critical* field, or a live validation error, is an actual
  // data-contract problem — never a missing optional/important field.
  const blockers = rows.filter(
    ({ meta, status }) => meta.importance === "critical" && status === "NULL",
  );
  const hasErrors = Object.keys(fieldErrors).length > 0;

  const missingByTier: Record<FieldImportance, typeof rows> = {
    critical: [],
    important: [],
    optional: [],
  };
  for (const row of rows) {
    if (row.status === "NULL") missingByTier[row.meta.importance].push(row);
  }

  const unsaved = rows.filter((r) => r.status === "UNSAVED");

  return (
    <div className="space-y-8 pt-6">
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Status</h2>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={competition.status} />
          <Badge variant="outline">{competition.visibility}</Badge>
          {competition.automaticStatusUpdatesDisabled && (
            <Badge variant="outline" className="text-muted-foreground">
              Automation off
            </Badge>
          )}
        </div>
      </section>

      {(blockers.length > 0 || hasErrors) && (
        <section className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-4">
          <h2 className="text-sm font-medium text-destructive">
            Cannot save
          </h2>
          <ul className="space-y-1 text-sm text-destructive">
            {blockers.map(({ meta }) => (
              <li key={meta.key}>
                <Link
                  href={tabHref(meta.tab, meta.key)}
                  className="underline underline-offset-2"
                >
                  {meta.label}
                </Link>{" "}
                is required.
              </li>
            ))}
            {Object.entries(fieldErrors).map(
              ([key, message]) =>
                message && (
                  <li key={key}>
                    {message}
                  </li>
                ),
            )}
          </ul>
        </section>
      )}

      <section className="space-y-4">
        <h2 className="text-sm font-medium text-muted-foreground">
          Information overview
        </h2>

        {(["critical", "important", "optional"] as const).map((tier) => {
          const missing = missingByTier[tier];
          if (missing.length === 0) return null;

          return (
            <div key={tier} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {IMPORTANCE_LABEL[tier]}
              </h3>
              <ul className="divide-y rounded-md border">
                {missing.map(({ meta }) => (
                  <li
                    key={meta.key}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <span>{meta.label}</span>
                    <Link
                      href={tabHref(meta.tab, meta.key)}
                      className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    >
                      Not specified
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}

        {missingByTier.critical.length === 0 &&
          missingByTier.important.length === 0 &&
          missingByTier.optional.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Everything tracked here is populated.
            </p>
          )}
      </section>

      {isDirty && unsaved.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            Unsaved changes
          </h2>
          <ul className="flex flex-wrap gap-2">
            {unsaved.map(({ meta }) => (
              <Badge key={meta.key} variant="outline">
                {meta.label}
              </Badge>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
