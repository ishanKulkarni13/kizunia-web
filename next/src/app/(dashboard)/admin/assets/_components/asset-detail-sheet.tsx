"use client";

/**
 * Admin Assets - Detail sheet
 *
 * Fetches the full AssetAdminDetailDTO fresh on every open (never reuses a
 * list row) — the same discipline the storage layer requires of a document
 * preview/download URL: nothing here is cached or persisted past the
 * request that produced it. Shows a category icon rather than a fake
 * preview whenever `previewUrl` is null (DOCUMENT assets — see
 * StorageProvider.buildDurableViewUrl).
 */

import { useEffect, useState } from "react";
import Image from "next/image";
import { DownloadIcon, FileIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/http";

import { AssetAdminApi } from "@/modules/assets/api/asset-admin-api";
import type { AssetAdminDetailDTO } from "@/modules/assets/dto/asset-admin.dto";
import { AssetStatus } from "@/generated/prisma";

const STATUS_VARIANT: Record<
  AssetStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  [AssetStatus.ACTIVE]: "default",
  [AssetStatus.DETACHED]: "secondary",
  [AssetStatus.DELETING]: "outline",
  [AssetStatus.DELETED]: "destructive",
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

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AssetDetailSheet({
  assetId,
  onOpenChange,
}: {
  assetId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [asset, setAsset] = useState<AssetAdminDetailDTO | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!assetId) {
      setAsset(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setAsset(null);

    AssetAdminApi.getById(assetId)
      .then((result) => {
        if (!cancelled) setAsset(result);
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(
          error instanceof ApiError ? error.message : "Could not load this asset.",
        );
        onOpenChange(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

  return (
    <Sheet open={assetId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Asset detail</SheetTitle>
          <SheetDescription className="font-mono text-xs">
            {assetId ?? ""}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          {loading && (
            <div className="space-y-3">
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          )}

          {!loading && asset && (
            <>
              <div className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-md border bg-muted">
                {asset.previewUrl ? (
                  <div className="relative h-full w-full">
                    <Image
                      src={asset.previewUrl}
                      alt=""
                      fill
                      sizes="400px"
                      className="object-contain"
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <FileIcon className="size-8" />
                    <span className="text-xs">
                      {asset.mimeType ?? asset.category}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={STATUS_VARIANT[asset.status]}>{asset.status}</Badge>
                <Badge variant="outline">{asset.category}</Badge>
                {asset.originatingPurpose && (
                  <Badge variant="secondary">{asset.originatingPurpose}</Badge>
                )}
              </div>

              <Separator />

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Type</dt>
                <dd>{asset.mimeType ?? asset.format ?? "—"}</dd>

                <dt className="text-muted-foreground">Size</dt>
                <dd>{formatBytes(asset.bytes)}</dd>

                {(asset.width !== null || asset.height !== null) && (
                  <>
                    <dt className="text-muted-foreground">Dimensions</dt>
                    <dd>
                      {asset.width ?? "—"} × {asset.height ?? "—"}
                    </dd>
                  </>
                )}

                <dt className="text-muted-foreground">Created</dt>
                <dd>{formatDate(asset.createdAt)}</dd>

                {asset.detachedAt && (
                  <>
                    <dt className="text-muted-foreground">Detached</dt>
                    <dd>{formatDate(asset.detachedAt)}</dd>
                  </>
                )}

                <dt className="text-muted-foreground">Updated</dt>
                <dd>{formatDate(asset.updatedAt)}</dd>
              </dl>

              <Separator />

              <div className="space-y-2">
                <p className="text-sm font-medium">
                  References ({asset.referenceCount})
                </p>
                {asset.references.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing currently references this asset.
                  </p>
                ) : (
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {asset.references.map((entry) => (
                      <li key={`${entry.entity}-${entry.slot}`}>
                        {entry.entity} · {entry.slot}
                        {entry.count > 1 ? ` (${entry.count})` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {asset.canDownload && (
                <>
                  <Separator />
                  <Button asChild variant="outline" className="w-full">
                    <a href={AssetAdminApi.downloadUrl(asset.id)}>
                      <DownloadIcon />
                      Download
                    </a>
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
