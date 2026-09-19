"use client";

/**
 * Admin Competitions - Table
 *
 * Row selection is local to this component and page-local by design: it
 * resets on every mount, and the page remounts this component (via a `key`
 * derived from the current search params) whenever the filters, sort, or
 * page change. There is no "select all N results across every page" —
 * deliberately not built, since the existing search state lives in the URL
 * and this component never reaches past what it was actually handed.
 *
 * Every mutation — inline edit, single-row delete/restore — goes through the
 * same server-authorized endpoints the single-competition editor already
 * uses. This component decides what to show, never what is allowed; a
 * disabled or hidden control here is convenience, not the security boundary.
 */

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import {
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";

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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError } from "@/lib/http";
import { cn } from "@/lib/utils";
import type { CompetitionStatus, CompetitionVisibility } from "@/generated/prisma";
import type { CompetitionAdminTableDTO } from "@/modules/competitions/backend/authorization/dto";
import { CompetitionApi } from "@/modules/competitions/api/competition-api";
import {
  COMPETITION_STATUS_OPTIONS,
  COMPETITION_VISIBILITY_OPTIONS,
} from "@/modules/competitions/constants";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/modules/competitions/components/status-badge";
import { VisibilityBadge } from "@/modules/competitions/components/visibility-badge";

import { BulkActionBar } from "./bulk-action-bar";

function getInitials(title: string): string {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
}

function formatDate(date: Date | null): string {
  if (!date) return "—";

  return new Date(date).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function AdminCompetitionsTable({
  competitions,
}: {
  competitions: readonly CompetitionAdminTableDTO[];
}) {
  const router = useRouter();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );

  const allSelected =
    competitions.length > 0 && selected.size === competitions.length;

  const someSelected = selected.size > 0 && !allSelected;

  function toggleAll() {
    setSelected(
      allSelected ? new Set() : new Set(competitions.map((c) => c.id)),
    );
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

  async function updateField(
    id: string,
    body: { status: CompetitionStatus } | { visibility: CompetitionVisibility },
  ) {
    try {
      setBusyId(id);
      await CompetitionApi.update(id, body);
      toast.success("Updated.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Could not update that.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function runRowAction(
    id: string,
    action: "delete" | "restore",
  ) {
    try {
      setBusyId(id);

      if (action === "delete") {
        await CompetitionApi.delete(id);
        toast.success("Deleted.");
      } else {
        await CompetitionApi.restore(id);
        toast.success("Restored.");
      }

      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Could not do that.",
      );
    } finally {
      setBusyId(null);
      setConfirmingDeleteId(null);
    }
  }

  return (
    <div className="space-y-3">
      <BulkActionBar
        selectedIds={[...selected]}
        onDone={() => {
          setSelected(new Set());
          router.refresh();
        }}
      />

      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={toggleAll}
                  aria-label="Select all rows"
                />
              </TableHead>
              <TableHead>Competition</TableHead>
              <TableHead>Organizer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Visibility</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Members</TableHead>
              <TableHead>Deadline</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {competitions.map((competition) => {
              const isDeleted = competition.deletedAt !== null;
              const isBusy = busyId === competition.id;

              return (
                <TableRow
                  key={competition.id}
                  data-state={selected.has(competition.id) ? "selected" : undefined}
                  className={cn(isDeleted && "opacity-60")}
                >
                  <TableCell>
                    <Checkbox
                      checked={selected.has(competition.id)}
                      onCheckedChange={() => toggleOne(competition.id)}
                      aria-label={`Select ${competition.title}`}
                    />
                  </TableCell>

                  <TableCell className="max-w-64">
                    <Link
                      href={`/admin/competitions/${competition.id}`}
                      className="flex items-center gap-3 hover:underline"
                    >
                      <Avatar className="size-8 shrink-0">
                        <AvatarImage src={competition.logoUrl ?? undefined} />
                        <AvatarFallback className="text-xs">
                          {getInitials(competition.title)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="truncate font-medium">
                        {competition.title}
                      </span>
                    </Link>
                  </TableCell>

                  <TableCell className="max-w-40 truncate text-muted-foreground">
                    {competition.organizer ?? "—"}
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {competition.permissions.canEdit ? (
                        <Select
                          disabled={isBusy}
                          value={competition.status ?? undefined}
                          onValueChange={(value) =>
                            updateField(competition.id, {
                              status: value as CompetitionStatus,
                            })
                          }
                        >
                          <SelectTrigger size="sm" className="h-7 w-auto border-none bg-transparent p-0 shadow-none">
                            <SelectValue>
                              <StatusBadge status={competition.status} />
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {COMPETITION_STATUS_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <StatusBadge status={competition.status} />
                      )}

                      {competition.automaticStatusUpdatesDisabled && (
                        <Badge
                          variant="outline"
                          className="text-muted-foreground"
                          title="Automatic status updates are turned off for this competition."
                        >
                          Auto off
                        </Badge>
                      )}
                    </div>
                  </TableCell>

                  <TableCell>
                    {competition.permissions.canEdit ? (
                      <Select
                        disabled={isBusy}
                        value={competition.visibility}
                        onValueChange={(value) =>
                          updateField(competition.id, {
                            visibility: value as CompetitionVisibility,
                          })
                        }
                      >
                        <SelectTrigger size="sm" className="h-7 w-auto border-none bg-transparent p-0 shadow-none">
                          <SelectValue>
                            <VisibilityBadge visibility={competition.visibility} />
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {COMPETITION_VISIBILITY_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <VisibilityBadge visibility={competition.visibility} />
                    )}
                  </TableCell>

                  <TableCell className="text-muted-foreground">
                    {competition.role ?? "—"}
                  </TableCell>

                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {competition.memberCount}
                  </TableCell>

                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(competition.registrationDeadline)}
                  </TableCell>

                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(competition.updatedAt)}
                  </TableCell>

                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          disabled={isBusy}
                          aria-label={`Actions for ${competition.title}`}
                          className="rounded-sm p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                        >
                          {isBusy ? (
                            <Loader2Icon className="size-4 animate-spin" />
                          ) : (
                            <MoreHorizontalIcon className="size-4" />
                          )}
                        </button>
                      </DropdownMenuTrigger>

                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/admin/competitions/${competition.id}`}>
                            <PencilIcon />
                            Edit
                          </Link>
                        </DropdownMenuItem>

                        {isDeleted && competition.canRestore && (
                          <DropdownMenuItem
                            onClick={() =>
                              runRowAction(competition.id, "restore")
                            }
                          >
                            <Undo2Icon />
                            Restore
                          </DropdownMenuItem>
                        )}

                        {!isDeleted && competition.permissions.canDelete && (
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() =>
                              setConfirmingDeleteId(competition.id)
                            }
                          >
                            <Trash2Icon />
                            Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={confirmingDeleteId !== null}
        onOpenChange={(open) => !open && setConfirmingDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this competition?</AlertDialogTitle>
            <AlertDialogDescription>
              This is a soft delete — it moves to Deleted and can be restored
              from there. It stops being visible anywhere else immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                confirmingDeleteId && runRowAction(confirmingDeleteId, "delete")
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
