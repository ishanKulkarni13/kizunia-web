"use client";

/**
 * Admin Competition Lifecycle - Preview table
 *
 * Every row here is a competition `CompetitionLifecycleService.preview`
 * already determined would change — this component decides what is shown
 * and which rows are selected, never whether a change is legitimate. Apply
 * sends only the ids of the checked rows to
 * `POST /admin/competitions/lifecycle/apply`, which re-reads and
 * re-evaluates each one against authoritative state before writing anything
 * — see that endpoint's doc comment. Unchecking a row here means "don't
 * apply this one during this operation", nothing more: it does not touch
 * that competition's `automaticStatusUpdatesDisabled` flag.
 */

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError } from "@/lib/http";
import { CompetitionApi } from "@/modules/competitions/api/competition-api";
import { StatusBadge } from "@/modules/competitions/components/status-badge";
import type { LifecyclePreviewRowDTO } from "@/modules/competitions/types/lifecycle.dto";
import { LifecycleReason } from "@/modules/competitions/lifecycle";

const REASON_LABEL: Record<LifecycleReason, string> = {
  [LifecycleReason.CANCELLED_PRESERVED]: "Cancelled — never changed automatically",
  [LifecycleReason.END_DATE_PASSED]: "End date has passed",
  [LifecycleReason.REGISTRATION_WINDOW_OPEN]: "Registration is open",
  [LifecycleReason.START_DATE_REACHED]: "Event has started",
  [LifecycleReason.REGISTRATION_DEADLINE_PASSED]: "Registration deadline has passed",
  [LifecycleReason.AWAITING_FIRST_MILESTONE]: "Next milestone ahead",
  [LifecycleReason.NO_LIFECYCLE_DATES]: "No lifecycle dates set",
  [LifecycleReason.AMBIGUOUS_LIFECYCLE_DATA]: "Insufficient lifecycle evidence",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";

  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function LifecyclePreviewTable({
  rows,
}: {
  rows: readonly LifecyclePreviewRowDTO[];
}) {
  const router = useRouter();

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(rows.map((row) => row.id)),
  );
  const [applying, setApplying] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const someSelected = selected.size > 0 && !allSelected;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.id)));
  }

  function toggleOne(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function apply() {
    try {
      setApplying(true);

      const result = await CompetitionApi.applyLifecycle([...selected]);

      if (result.skipped.length > 0) {
        toast.success(
          `Updated ${result.applied} of ${selected.size}. ${result.skipped.length} could not be applied — they may have changed since this preview was shown.`,
        );
      } else {
        toast.success(`Updated ${result.applied} competition${result.applied === 1 ? "" : "s"}.`);
      }

      setSelected(new Set());
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.message);
      } else {
        toast.error("Something went wrong applying these changes.");
      }
    } finally {
      setApplying(false);
      setConfirming(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">
          {selected.size} of {rows.length} selected
        </span>

        <Button
          size="sm"
          disabled={selected.size === 0 || applying}
          onClick={() => setConfirming(true)}
        >
          {applying && <Loader2Icon className="animate-spin" />}
          Apply {selected.size > 0 ? `(${selected.size})` : ""}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead>Competition</TableHead>
              <TableHead>Current status</TableHead>
              <TableHead />
              <TableHead>Proposed status</TableHead>
              <TableHead>Why</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Checkbox
                    checked={selected.has(row.id)}
                    onCheckedChange={() => toggleOne(row.id)}
                    aria-label={`Select ${row.title}`}
                  />
                </TableCell>
                <TableCell>
                  <Link
                    href={`/admin/competitions/${row.id}`}
                    className="font-medium hover:underline"
                  >
                    {row.title}
                  </Link>
                </TableCell>
                <TableCell>
                  <StatusBadge status={row.currentStatus} />
                </TableCell>
                <TableCell className="text-muted-foreground">→</TableCell>
                <TableCell>
                  <StatusBadge status={row.proposedStatus} />
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  <div>{REASON_LABEL[row.reason]}</div>
                  {row.drivingDate && (
                    <div className="text-xs">{formatDate(row.drivingDate)}</div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Apply {selected.size} status{" "}
              {selected.size === 1 ? "change" : "changes"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Each selected competition&apos;s status will be recalculated one
              more time from its current dates before it is written — if
              anything changed since this preview was shown, that competition
              is skipped rather than forced to the value shown here. This
              only affects the selected competitions for this operation; it
              does not turn automatic status updates on or off for any of
              them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={applying}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={applying} onClick={apply}>
              Apply
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
