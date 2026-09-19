"use client";

/**
 * Admin Suggestion Asset Grid
 *
 * A separate, much smaller component than the contributor
 * `SuggestionAssetGrid` — that one carries upload state, quota constants,
 * and `useAssetUpload`, none of which apply here. An admin can only view,
 * download, and remove; removal is available regardless of the suggestion's
 * status and never changes it.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, ExternalLink, FileText, Loader2, X } from "lucide-react";
import { toast } from "sonner";

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
import { ApiError } from "@/lib/http";

import { useCompetitionSuggestionAdminStore } from "@/modules/competitions/store/competition-suggestion-admin-store";
import type { CompetitionSuggestionAssetDTO } from "@/modules/competitions/types/suggestion";

function formatBytes(bytes: number | null): string | null {
  if (!bytes) return null;

  const kb = bytes / 1024;

  if (kb < 1024) return `${kb.toFixed(0)} KB`;

  return `${(kb / 1024).toFixed(1)} MB`;
}

interface AdminSuggestionAssetGridProps {
  suggestionId: string;
  assets: CompetitionSuggestionAssetDTO[];
  canRemoveAssets: boolean;
}

export function AdminSuggestionAssetGrid({
  suggestionId,
  assets: initialAssets,
  canRemoveAssets,
}: AdminSuggestionAssetGridProps) {
  const router = useRouter();

  const detachAsset = useCompetitionSuggestionAdminStore(
    (state) => state.detachAsset,
  );

  const [assets, setAssets] = useState(initialAssets);
  const [confirmingAssetId, setConfirmingAssetId] = useState<string | null>(
    null,
  );
  const [removingAssetId, setRemovingAssetId] = useState<string | null>(null);

  async function handleRemove(assetId: string) {
    setRemovingAssetId(assetId);

    try {
      await detachAsset(suggestionId, assetId);

      setAssets((current) => current.filter((item) => item.assetId !== assetId));

      toast.success("Asset removed.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Could not remove this asset.",
      );
    } finally {
      setRemovingAssetId(null);
      setConfirmingAssetId(null);
    }
  }

  if (assets.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No supporting material was attached.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      {assets.map((item) => {
        const size = formatBytes(item.asset.bytes);

        return (
          <div
            key={item.assetId}
            className="w-32 space-y-1.5"
          >
            <div className="relative size-32 overflow-hidden rounded-lg border bg-muted">
              {item.asset.category === "DOCUMENT" ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
                  <FileText className="size-6" />
                  <span className="text-xs font-medium">PDF</span>
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.asset.secureUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              )}

              {canRemoveAssets && (
                <button
                  type="button"
                  onClick={() => setConfirmingAssetId(item.assetId)}
                  disabled={removingAssetId === item.assetId}
                  className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 disabled:opacity-50"
                  aria-label="Remove"
                >
                  {removingAssetId === item.assetId ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <X className="size-3" />
                  )}
                </button>
              )}
            </div>

            {/* `viewUrl`, not `secureUrl` — a document's stored delivery URL
                is not fetchable, and only the provider-computed one opens. */}
            <div className="flex items-center justify-center gap-3 text-xs">
              <a
                href={item.asset.viewUrl ?? item.asset.secureUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
              >
                <ExternalLink className="size-3" /> View
              </a>

              {item.asset.downloadUrl && (
                <a
                  href={item.asset.downloadUrl}
                  className="flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
                >
                  <Download className="size-3" /> Download
                </a>
              )}
            </div>

            {(item.asset.originalFilename || size) && (
              <p className="truncate text-center text-[10px] text-muted-foreground">
                {item.asset.originalFilename ?? ""}
                {item.asset.originalFilename && size ? " · " : ""}
                {size ?? ""}
              </p>
            )}
          </div>
        );
      })}

      <AlertDialog
        open={confirmingAssetId !== null}
        onOpenChange={(open) => !open && setConfirmingAssetId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this file?</AlertDialogTitle>
            <AlertDialogDescription>
              It will be detached from this suggestion. This does not change
              the suggestion&apos;s status.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                confirmingAssetId && handleRemove(confirmingAssetId)
              }
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
