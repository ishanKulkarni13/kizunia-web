"use client";

/**
 * Admin Asset Reconciliation - Preview table
 *
 * Every row here is a candidate `AssetReconciliationService.previewCandidates`
 * already found — this component decides what is shown and which rows are
 * selected, never whether a candidate is legitimate. Apply sends only the
 * ids of the checked rows to `POST /admin/assets/reconciliation/apply`,
 * which re-reads and re-evaluates each one against authoritative state
 * before doing anything — see that endpoint's doc comment.
 *
 * Unlike the Competition lifecycle table, selection starts EMPTY: these
 * operations can physically delete files from storage, so nothing is
 * pre-selected. Selection is also capped client-side at
 * MAX_RECONCILIATION_APPLY_IDS — the server enforces the same cap
 * authoritatively; a larger set is applied in successive rounds.
 */

import { useRouter } from "next/navigation";
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
import { Badge } from "@/components/ui/badge";
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

import { AssetAdminApi } from "@/modules/assets/api/asset-admin-api";
import { MAX_RECONCILIATION_APPLY_IDS } from "@/modules/assets/schemas/apply-asset-reconciliation";
import type {
  AssetReconciliationApplyResultRowDTO,
  AssetReconciliationCandidateDTO,
} from "@/modules/assets/dto/asset-admin.dto";

const KIND_LABEL: Record<AssetReconciliationCandidateDTO["kind"], string> = {
  UNREFERENCED_ACTIVE: "Unreferenced (past grace period)",
  DETACHED_AWAITING_CLEANUP: "Detached — awaiting cleanup",
  DELETING_RETRY: "Deletion retry",
};

const OUTCOME_LABEL: Record<
  AssetReconciliationApplyResultRowDTO["outcome"],
  string
> = {
  DETACHED: "Detached",
  DELETED: "Deleted",
  DEFERRED: "Deferred — will retry",
  NOT_ELIGIBLE: "No longer eligible",
  NOT_FOUND: "Not found",
};

const OUTCOME_VARIANT: Record<
  AssetReconciliationApplyResultRowDTO["outcome"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  DETACHED: "secondary",
  DELETED: "default",
  DEFERRED: "outline",
  NOT_ELIGIBLE: "outline",
  NOT_FOUND: "destructive",
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

export function ReconciliationPreviewTable({
  rows,
}: {
  rows: readonly AssetReconciliationCandidateDTO[];
}) {
  const router = useRouter();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [results, setResults] = useState<
    Map<string, AssetReconciliationApplyResultRowDTO>
  >(new Map());

  const allSelected = rows.length > 0 && selected.size === Math.min(rows.length, MAX_RECONCILIATION_APPLY_IDS);
  const someSelected = selected.size > 0 && !allSelected;

  function toggleAll() {
    if (selected.size > 0) {
      setSelected(new Set());
      return;
    }

    const capped = rows.slice(0, MAX_RECONCILIATION_APPLY_IDS).map((row) => row.id);
    if (rows.length > MAX_RECONCILIATION_APPLY_IDS) {
      toast.info(
        `Only the first ${MAX_RECONCILIATION_APPLY_IDS} were selected — apply in rounds for the rest.`,
      );
    }
    setSelected(new Set(capped));
  }

  function toggleOne(id: string) {
    setSelected((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
        return next;
      }

      if (next.size >= MAX_RECONCILIATION_APPLY_IDS) {
        toast.error(`You can apply at most ${MAX_RECONCILIATION_APPLY_IDS} at a time.`);
        return current;
      }

      next.add(id);
      return next;
    });
  }

  async function apply() {
    try {
      setApplying(true);

      const result = await AssetAdminApi.applyReconciliation([...selected]);

      setResults(new Map(result.results.map((row) => [row.id, row])));

      const succeeded = result.results.filter(
        (row) => row.outcome === "DETACHED" || row.outcome === "DELETED",
      ).length;

      if (succeeded < result.results.length) {
        toast.success(
          `${succeeded} of ${result.results.length} applied. The rest were no longer eligible or deferred — see the table below.`,
        );
      } else {
        toast.success(`Applied to ${succeeded} asset${succeeded === 1 ? "" : "s"}.`);
      }

      setSelected(new Set());
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.message);
      } else {
        toast.error("Something went wrong applying reconciliation.");
      }
    } finally {
      setApplying(false);
      setConfirming(false);
    }
  }

  const groups: { kind: AssetReconciliationCandidateDTO["kind"]; rows: AssetReconciliationCandidateDTO[] }[] =
    (["UNREFERENCED_ACTIVE", "DETACHED_AWAITING_CLEANUP", "DELETING_RETRY"] as const)
      .map((kind) => ({ kind, rows: rows.filter((row) => row.kind === kind) }))
      .filter((group) => group.rows.length > 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">
          {selected.size} of {Math.min(rows.length, MAX_RECONCILIATION_APPLY_IDS)} selectable
          on this page
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

      {groups.map((group) => (
        <div key={group.kind} className="space-y-2">
          <h2 className="text-sm font-medium">{KIND_LABEL[group.kind]}</h2>

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
                  <TableHead>Asset ID</TableHead>
                  <TableHead>Why</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Detached</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.rows.map((row) => {
                  const result = results.get(row.id);

                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(row.id)}
                          onCheckedChange={() => toggleOne(row.id)}
                          aria-label={`Select asset ${row.id}`}
                        />
                      </TableCell>
                      <TableCell className="max-w-40 truncate font-mono text-xs text-muted-foreground">
                        {row.id}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.reason}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(row.createdAt)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(row.detachedAt)}
                      </TableCell>
                      <TableCell>
                        {result && (
                          <Badge
                            variant={OUTCOME_VARIANT[result.outcome]}
                            title={result.reason}
                          >
                            {OUTCOME_LABEL[result.outcome]}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      ))}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Apply reconciliation to {selected.size} asset
              {selected.size === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Each selected asset is re-checked one more time before anything
              happens — if it changed since this preview was shown (e.g. it
              picked up a new reference), it is reported as no longer
              eligible rather than forced. This can physically delete files
              from storage for detached and retry candidates; unreferenced
              candidates are only moved to detached, not deleted outright.
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
