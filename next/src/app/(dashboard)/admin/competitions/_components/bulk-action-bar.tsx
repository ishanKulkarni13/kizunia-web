"use client";

/**
 * Admin Competitions - Bulk action bar
 *
 * Appears only when at least one row is selected. Every action here calls
 * the single `POST /api/v1/admin/competitions/bulk` endpoint, which
 * authorizes every selected id server-side before touching anything — this
 * bar's job is only to collect intent and show the outcome, never to decide
 * who may do what.
 *
 * Selection is page-local and owned by the parent table; this component
 * never persists it anywhere beyond the current render.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Loader2Icon, Trash2Icon, Undo2Icon, XIcon } from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError } from "@/lib/http";
import { CompetitionApi } from "@/modules/competitions/api/competition-api";
import {
  COMPETITION_STATUS_OPTIONS,
  COMPETITION_VISIBILITY_OPTIONS,
} from "@/modules/competitions/constants";
import type { CompetitionStatus, CompetitionVisibility } from "@/generated/prisma";

export interface BulkActionBarProps {
  readonly selectedIds: readonly string[];
  readonly onDone: () => void;
}

export function BulkActionBar({ selectedIds, onDone }: BulkActionBarProps) {
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (selectedIds.length === 0) {
    return null;
  }

  async function run(
    action: Parameters<typeof CompetitionApi.bulkUpdate>[0]["action"],
    successMessage: string,
  ) {
    try {
      setBusy(true);

      const result = await CompetitionApi.bulkUpdate({
        ids: [...selectedIds],
        action,
      });

      toast.success(`${successMessage} (${result.updated}).`);
      onDone();
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.message);
      } else {
        toast.error("Something went wrong applying that action.");
      }
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <div className="sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-background p-3 shadow-sm">
      <span className="text-sm font-medium">
        {selectedIds.length} selected
      </span>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Select
          disabled={busy}
          onValueChange={(value) =>
            run(
              { type: "SET_STATUS", status: value as CompetitionStatus },
              "Status updated",
            )
          }
        >
          <SelectTrigger size="sm" className="w-40">
            <SelectValue placeholder="Set status" />
          </SelectTrigger>
          <SelectContent>
            {COMPETITION_STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          disabled={busy}
          onValueChange={(value) =>
            run(
              {
                type: "SET_VISIBILITY",
                visibility: value as CompetitionVisibility,
              },
              "Visibility updated",
            )
          }
        >
          <SelectTrigger size="sm" className="w-40">
            <SelectValue placeholder="Set visibility" />
          </SelectTrigger>
          <SelectContent>
            {COMPETITION_VISIBILITY_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => run({ type: "RESTORE" }, "Restored")}
        >
          <Undo2Icon />
          Restore
        </Button>

        <Button
          size="sm"
          variant="destructive"
          disabled={busy}
          onClick={() => setConfirmingDelete(true)}
        >
          {busy ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
          Delete
        </Button>

        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={onDone}
          aria-label="Clear selection"
        >
          <XIcon />
        </Button>
      </div>

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedIds.length}{" "}
              {selectedIds.length === 1 ? "competition" : "competitions"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This is a soft delete — every selected competition moves to
              Deleted and can be restored from there. It stops being visible
              anywhere else immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => run({ type: "DELETE" }, "Deleted")}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
