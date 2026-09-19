"use client";

/**
 * Admin Assets - Table
 *
 * Owns its own filter/pagination state client-side, the same shape as
 * `AdminTechnologiesTable` — Asset has no per-resource role grid and no
 * existing filter-spec registry the way Competitions does, so a local
 * `AssetAdminApi.search` call on change is simpler than wiring the shared
 * URL-param search machinery for five fields. Seeded with the
 * server-rendered `initialItems`/`initialPagination` so first paint needs
 * no client fetch.
 */

import { useEffect, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import {
  DownloadIcon,
  EyeIcon,
  FileIcon,
  Loader2Icon,
  MoreHorizontalIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
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
import { ApiError } from "@/lib/http";
import type { PaginationMeta } from "@/lib/search";
import { AssetCategory, AssetStatus } from "@/generated/prisma";

import { AssetAdminApi } from "@/modules/assets/api/asset-admin-api";
import type { AssetAdminListRowDTO } from "@/modules/assets/dto/asset-admin.dto";

import { AssetDetailSheet } from "./asset-detail-sheet";

const STATUS_VARIANT: Record<
  AssetStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  [AssetStatus.ACTIVE]: "default",
  [AssetStatus.DETACHED]: "secondary",
  [AssetStatus.DELETING]: "outline",
  [AssetStatus.DELETED]: "destructive",
};

const CATEGORY_LABELS: Record<AssetCategory, string> = {
  [AssetCategory.IMAGE]: "Image",
  [AssetCategory.VIDEO]: "Video",
  [AssetCategory.DOCUMENT]: "Document",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function PreviewThumb({ asset }: { asset: AssetAdminListRowDTO }) {
  if (asset.previewUrl) {
    return (
      <span className="relative inline-block size-10 shrink-0 overflow-hidden rounded-md bg-muted">
        <Image
          src={asset.previewUrl}
          alt=""
          fill
          sizes="40px"
          className="object-cover"
        />
      </span>
    );
  }

  return (
    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
      <FileIcon className="size-4" />
    </span>
  );
}

function UsedAs({ asset }: { asset: AssetAdminListRowDTO }) {
  if (asset.references.length === 0) {
    return <span className="text-muted-foreground">Unreferenced</span>;
  }

  const shown = asset.references.slice(0, 2);
  const remaining = asset.references.length - shown.length;

  return (
    <div className="flex flex-col gap-0.5">
      {shown.map((entry) => (
        <span key={`${entry.entity}-${entry.slot}`} className="text-xs">
          {entry.entity} · {entry.slot}
        </span>
      ))}
      {remaining > 0 && (
        <span className="text-xs text-muted-foreground">+{remaining} more</span>
      )}
    </div>
  );
}

export function AssetAdminTable({
  initialItems,
  initialPagination,
}: {
  initialItems: readonly AssetAdminListRowDTO[];
  initialPagination: PaginationMeta;
}) {
  const [items, setItems] = useState<readonly AssetAdminListRowDTO[]>(initialItems);
  const [pagination, setPagination] = useState<PaginationMeta>(initialPagination);
  const [loading, setLoading] = useState(false);

  const [id, setId] = useState("");
  const [status, setStatus] = useState<AssetStatus | "ALL">("ALL");
  const [category, setCategory] = useState<AssetCategory | "ALL">("ALL");
  const [referenced, setReferenced] = useState<"ALL" | "yes" | "no">("ALL");
  const [page, setPage] = useState(1);

  const [viewingAssetId, setViewingAssetId] = useState<string | null>(null);

  async function fetchItems() {
    try {
      setLoading(true);

      const params: Record<string, string> = { page: String(page), limit: "20" };
      if (id.trim()) params.id = id.trim();
      if (status !== "ALL") params.status = status;
      if (category !== "ALL") params.category = category;
      if (referenced !== "ALL") params.referenced = referenced;

      const result = await AssetAdminApi.search(params);

      setItems(result.items);
      setPagination(result.pagination);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not load assets.");
    } finally {
      setLoading(false);
    }
  }

  // Debounced re-fetch on any filter/page change. Skips the very first
  // render since `initialItems` already covers the default (no filters,
  // page 1) state.
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
  }, [id, status, category, referenced, page]);

  // Any filter change resets to page 1, so a stale page number from a
  // narrower filter set never produces an out-of-range fetch.
  function resetToFirstPage() {
    setPage(1);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={id}
          onChange={(e) => {
            setId(e.target.value);
            resetToFirstPage();
          }}
          placeholder="Find by asset ID…"
          className="h-9 w-56"
        />

        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value as AssetStatus | "ALL");
            resetToFirstPage();
          }}
        >
          <SelectTrigger size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {Object.values(AssetStatus).map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={category}
          onValueChange={(value) => {
            setCategory(value as AssetCategory | "ALL");
            resetToFirstPage();
          }}
        >
          <SelectTrigger size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All categories</SelectItem>
            {Object.values(AssetCategory).map((value) => (
              <SelectItem key={value} value={value}>
                {CATEGORY_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={referenced}
          onValueChange={(value) => {
            setReferenced(value as "ALL" | "yes" | "no");
            resetToFirstPage();
          }}
        >
          <SelectTrigger size="sm" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Referenced or not</SelectItem>
            <SelectItem value="yes">Referenced</SelectItem>
            <SelectItem value="no">Unreferenced</SelectItem>
          </SelectContent>
        </Select>

        {loading && <Loader2Icon className="size-4 animate-spin text-muted-foreground" />}
      </div>

      {items.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No assets match these filters</EmptyTitle>
            <EmptyDescription>
              Try clearing a filter, or check back once uploads exist.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14" />
                <TableHead>Asset ID</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Used as</TableHead>
                <TableHead
                  title="Distinct referencing records — one record may occupy more than one slot."
                >
                  Refs
                </TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>

            <TableBody>
              {items.map((asset) => (
                <TableRow key={asset.id}>
                  <TableCell>
                    <PreviewThumb asset={asset} />
                  </TableCell>

                  <TableCell className="max-w-40 truncate font-mono text-xs text-muted-foreground">
                    {asset.id}
                  </TableCell>

                  <TableCell>
                    <Badge variant="outline">{CATEGORY_LABELS[asset.category]}</Badge>
                  </TableCell>

                  <TableCell>
                    <Badge variant={STATUS_VARIANT[asset.status]}>{asset.status}</Badge>
                  </TableCell>

                  <TableCell>
                    <UsedAs asset={asset} />
                  </TableCell>

                  <TableCell className="tabular-nums">{asset.referenceCount}</TableCell>

                  <TableCell className="text-muted-foreground">
                    {formatDate(asset.createdAt)}
                  </TableCell>

                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Actions for asset ${asset.id}`}
                          className="rounded-sm p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <MoreHorizontalIcon className="size-4" />
                        </button>
                      </DropdownMenuTrigger>

                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setViewingAssetId(asset.id)}>
                          <EyeIcon />
                          View
                        </DropdownMenuItem>

                        {asset.canDownload && (
                          <DropdownMenuItem asChild>
                            <a href={AssetAdminApi.downloadUrl(asset.id)}>
                              <DownloadIcon />
                              Download
                            </a>
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Page {pagination.page} of {Math.max(pagination.totalPages, 1)} ·{" "}
          {pagination.total} asset{pagination.total === 1 ? "" : "s"}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!pagination.hasPreviousPage || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!pagination.hasNextPage || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>

      <AssetDetailSheet
        assetId={viewingAssetId}
        onOpenChange={(open) => !open && setViewingAssetId(null)}
      />
    </div>
  );
}
