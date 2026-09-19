"use client";

/**
 * Admin Technologies - Table
 *
 * Unlike Competitions' admin table, this one owns its own search/filter
 * state client-side rather than deriving it from URL search params — there
 * is no per-row role grid or multi-filter registry here, just a name search,
 * a type filter and an active/deleted toggle, so a local `TechnologyApi.search`
 * call on change is simpler than wiring the shared URL-param search
 * machinery for three fields. Seeded with the server-rendered `initialItems`
 * so the first paint needs no client fetch.
 *
 * Per-row action visibility is read directly off each row's own
 * `permissions` (from `TechnologyAdminDTO`) — never re-derived from role,
 * same rule the Competitions table follows.
 */

import { useEffect, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import {
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { ApiError } from "@/lib/http";
import { cn } from "@/lib/utils";
import { TechnologyType } from "@/generated/prisma";

import { TechnologyApi } from "@/modules/technologies/api/technology-api";
import type { TechnologyAdminDTO } from "@/modules/technologies/backend/dto/technology-admin.dto";

import { TechnologyFormDialog } from "./technology-form-dialog";

const TYPE_LABELS: Record<TechnologyType, string> = {
  [TechnologyType.LANGUAGE]: "Language",
  [TechnologyType.FRAMEWORK]: "Framework",
  [TechnologyType.LIBRARY]: "Library",
  [TechnologyType.DATABASE]: "Database",
  [TechnologyType.RUNTIME]: "Runtime",
  [TechnologyType.TOOL]: "Tool",
  [TechnologyType.PLATFORM]: "Platform",
  [TechnologyType.SERVICE]: "Service",
  [TechnologyType.OTHER]: "Other",
};

const TYPE_FILTER_OPTIONS = Object.entries(TYPE_LABELS) as [
  TechnologyType,
  string,
][];

function IconThumb({ technology }: { technology: TechnologyAdminDTO }) {
  if (technology.iconAsset?.secureUrl) {
    return (
      <span className="relative inline-block size-8 shrink-0 overflow-hidden rounded-md bg-muted">
        <Image
          src={technology.iconAsset.secureUrl}
          alt=""
          fill
          sizes="32px"
          className="object-cover"
        />
      </span>
    );
  }

  return (
    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium text-muted-foreground">
      {technology.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function AdminTechnologiesTable({
  initialItems,
}: {
  initialItems: readonly TechnologyAdminDTO[];
}) {
  const [items, setItems] = useState<readonly TechnologyAdminDTO[]>(
    initialItems,
  );
  const [loading, setLoading] = useState(false);

  const [q, setQ] = useState("");
  const [type, setType] = useState<TechnologyType | "ALL">("ALL");
  const [showDeleted, setShowDeleted] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TechnologyAdminDTO | undefined>(
    undefined,
  );

  async function fetchItems() {
    try {
      setLoading(true);

      const params: Record<string, string> = { limit: "100" };
      if (q.trim()) params.q = q.trim();
      if (type !== "ALL") params.type = type;
      if (showDeleted) params.includeDeleted = "true";

      const result = await TechnologyApi.search(params);

      setItems(
        showDeleted
          ? result.items
          : result.items.filter((item) => item.deletedAt === null),
      );
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Could not load technologies.",
      );
    } finally {
      setLoading(false);
    }
  }

  // Debounced re-fetch on any filter change. Skips the very first render
  // since `initialItems` already covers the default (no filters) state.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (!mounted) {
      setMounted(true);
      return;
    }

    const handle = setTimeout(() => {
      void fetchItems();
    }, 300);

    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, type, showDeleted]);

  function upsertLocal(updated: TechnologyAdminDTO) {
    setItems((current) => {
      const exists = current.some((item) => item.id === updated.id);

      if (!exists) {
        return showDeleted || updated.deletedAt === null
          ? [updated, ...current]
          : current;
      }

      return current.map((item) => (item.id === updated.id ? updated : item));
    });
  }

  async function runRowAction(id: string, action: "delete" | "restore") {
    try {
      setBusyId(id);

      if (action === "delete") {
        await TechnologyApi.delete(id);
        toast.success("Deleted.");
      } else {
        await TechnologyApi.restore(id);
        toast.success("Restored.");
      }

      await fetchItems();
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name…"
            className="h-9 w-56"
          />

          <Select
            value={type}
            onValueChange={(value) => setType(value as TechnologyType | "ALL")}
          >
            <SelectTrigger size="sm" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All types</SelectItem>
              {TYPE_FILTER_OPTIONS.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Tabs
            value={showDeleted ? "deleted" : "active"}
            onValueChange={(value) => setShowDeleted(value === "deleted")}
          >
            <TabsList>
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="deleted">Deleted</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <Button
          type="button"
          size="sm"
          onClick={() => {
            setEditing(undefined);
            setFormOpen(true);
          }}
        >
          <PlusIcon />
          Create Technology
        </Button>
      </div>

      {items.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>
              {showDeleted ? "No deleted technologies" : "No technologies yet"}
            </EmptyTitle>
            <EmptyDescription>
              {showDeleted
                ? "Nothing has been soft-deleted."
                : "Create the first entry in the technology taxonomy."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>

            <TableBody>
              {items.map((technology) => {
                const isDeleted = technology.deletedAt !== null;
                const isBusy = busyId === technology.id;

                return (
                  <TableRow
                    key={technology.id}
                    className={cn(isDeleted && "opacity-60")}
                  >
                    <TableCell>
                      <IconThumb technology={technology} />
                    </TableCell>

                    <TableCell className="max-w-52">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">
                          {technology.name}
                        </span>
                        {isDeleted && (
                          <Badge variant="outline" className="shrink-0">
                            Deleted
                          </Badge>
                        )}
                      </div>
                    </TableCell>

                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {technology.slug}
                    </TableCell>

                    <TableCell>
                      <Badge variant="secondary">
                        {TYPE_LABELS[technology.type]}
                      </Badge>
                    </TableCell>

                    <TableCell className="max-w-72 truncate text-muted-foreground">
                      {technology.description ?? "—"}
                    </TableCell>

                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            disabled={isBusy}
                            aria-label={`Actions for ${technology.name}`}
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
                          {technology.permissions.canEdit && (
                            <DropdownMenuItem
                              onClick={() => {
                                setEditing(technology);
                                setFormOpen(true);
                              }}
                            >
                              <PencilIcon />
                              Edit
                            </DropdownMenuItem>
                          )}

                          {isDeleted && technology.permissions.canRestore && (
                            <DropdownMenuItem
                              onClick={() =>
                                runRowAction(technology.id, "restore")
                              }
                            >
                              <Undo2Icon />
                              Restore
                            </DropdownMenuItem>
                          )}

                          {!isDeleted && technology.permissions.canDelete && (
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() =>
                                setConfirmingDeleteId(technology.id)
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
      )}

      {loading && (
        <p className="text-xs text-muted-foreground">Loading…</p>
      )}

      <AlertDialog
        open={confirmingDeleteId !== null}
        onOpenChange={(open) => !open && setConfirmingDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this technology?</AlertDialogTitle>
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

      <TechnologyFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        technology={editing}
        onSaved={(saved) => {
          upsertLocal(saved);
          setEditing(saved);
        }}
      />
    </div>
  );
}
