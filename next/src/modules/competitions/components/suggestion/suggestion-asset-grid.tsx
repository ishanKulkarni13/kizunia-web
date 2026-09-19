"use client";

import { useCallback, useRef, useState } from "react";
import { Download, ExternalLink, FileText, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { useAssetUpload } from "@/modules/assets/frontend/hooks/use-asset-upload";
import { getErrorMessage } from "@/utils/error";

import { useCompetitionSuggestionStore } from "../../store/competition-suggestion-store";
import type { CompetitionSuggestionAssetDTO } from "../../types/suggestion";

const MAX_TOTAL_ASSETS = 5;
const MAX_IMAGE_ASSETS = 4;
const MAX_PDF_ASSETS = 1;

const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];
const PDF_MIME_TYPE = "application/pdf";

interface PendingUpload {
  key: string;
  fileName: string;
  error: string | null;
}

type AssetsUpdater = (
  current: CompetitionSuggestionAssetDTO[],
) => CompetitionSuggestionAssetDTO[];

interface SuggestionAssetGridProps {
  suggestionId: string;
  assets: CompetitionSuggestionAssetDTO[];
  /**
   * Functional updater, applied by the parent against its OWN latest state
   * (e.g. `setDraft((prev) => ({ ...prev, assets: update(prev.assets) }))`).
   * Attach/detach responses only ever add-or-remove the one asset that
   * specific request affected — never replace the whole array with a
   * server-returned snapshot, which can arrive out of order when multiple
   * uploads are in flight and would otherwise silently drop a sibling
   * upload's result.
   */
  onAssetsChange: (updater: AssetsUpdater) => void;
  /** Read-only view for a suggestion that is no longer editable — no "+"
   * tile, no remove overlay, just the attached tiles. */
  readOnly?: boolean;
}

/**
 * The 1:1 tile gallery for a suggestion's supporting material. No captions,
 * no ordering/drag-drop, no cover asset — V1 deliberately omits all of that.
 * Composes `useAssetUpload` directly rather than `ReusableImageUploader`,
 * which is single-file, image-only, and crop-oriented — none of which fits
 * a mixed image+PDF multi-file gallery.
 */
export function SuggestionAssetGrid({
  suggestionId,
  assets,
  onAssetsChange,
  readOnly = false,
}: SuggestionAssetGridProps) {
  const attachAsset = useCompetitionSuggestionStore(
    (state) => state.attachAsset,
  );

  const detachAsset = useCompetitionSuggestionStore(
    (state) => state.detachAsset,
  );

  const { upload } = useAssetUpload({
    purpose: "COMPETITION_SUGGESTION_GALLERY",
    targetEntityId: suggestionId,
  });

  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [removingAssetId, setRemovingAssetId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const imageCount = assets.filter(
    (item) => item.asset.category === "IMAGE",
  ).length;

  const pdfCount = assets.filter(
    (item) => item.asset.category === "DOCUMENT",
  ).length;

  const totalCount = assets.length + pending.length;
  const canAddMore = !readOnly && totalCount < MAX_TOTAL_ASSETS;

  const uploadFile = useCallback(
    async (file: File) => {
      const isPdf = file.type === PDF_MIME_TYPE;
      const isImage = IMAGE_MIME_TYPES.includes(file.type);

      if (!isPdf && !isImage) {
        toast.error(
          "Only images (PNG, JPEG, WEBP) and PDF files are supported.",
        );
        return;
      }

      if (assets.length + pending.length >= MAX_TOTAL_ASSETS) {
        toast.error(`You can attach at most ${MAX_TOTAL_ASSETS} files.`);
        return;
      }

      if (isImage && imageCount >= MAX_IMAGE_ASSETS) {
        toast.error(`You can attach at most ${MAX_IMAGE_ASSETS} images.`);
        return;
      }

      if (isPdf && pdfCount >= MAX_PDF_ASSETS) {
        toast.error(`You can attach at most ${MAX_PDF_ASSETS} PDF.`);
        return;
      }

      const key = `${file.name}-${Date.now()}-${Math.random()}`;

      setPending((prev) => [
        ...prev,
        { key, fileName: file.name, error: null },
      ]);

      try {
        const asset = await upload(file);

        const updated = await attachAsset(suggestionId, asset.id);

        const attachedItem = updated.assets.find(
          (item) => item.assetId === asset.id,
        );

        // Merge only the one asset this call attached, keyed by id — never
        // replace the whole array with `updated.assets` (a snapshot that,
        // under concurrent uploads, can arrive after a sibling upload's own
        // attach and would silently overwrite it away).
        if (attachedItem) {
          onAssetsChange((current) =>
            current.some((item) => item.assetId === attachedItem.assetId)
              ? current
              : [...current, attachedItem],
          );
        }

        setPending((prev) => prev.filter((item) => item.key !== key));
      } catch (error) {
        setPending((prev) =>
          prev.map((item) =>
            item.key === key
              ? { ...item, error: getErrorMessage(error, "Upload failed.") }
              : item,
          ),
        );
      }
    },
    [
      assets.length,
      pending.length,
      imageCount,
      pdfCount,
      upload,
      attachAsset,
      suggestionId,
      onAssetsChange,
    ],
  );

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;

      // Each file uploads independently — deliberately not awaited in
      // sequence, so selecting several images uploads them in parallel.
      Array.from(fileList).forEach((file) => void uploadFile(file));
    },
    [uploadFile],
  );

  const handleRemove = useCallback(
    async (assetId: string) => {
      setRemovingAssetId(assetId);

      try {
        await detachAsset(suggestionId, assetId);

        // Remove only this asset id from the parent's latest state — same
        // reasoning as attach: a stale full-list response must never
        // overwrite a concurrently-completed upload.
        onAssetsChange((current) =>
          current.filter((item) => item.assetId !== assetId),
        );
      } finally {
        setRemovingAssetId(null);
      }
    },
    [detachAsset, suggestionId, onAssetsChange],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {assets.map((item) => (
          <div
            key={item.assetId}
            className="group relative size-24 shrink-0 overflow-hidden rounded-lg border bg-muted"
          >
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

            <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/60 py-1 opacity-0 transition-opacity group-hover:opacity-100">
              {/* `viewUrl`, not `secureUrl` — see AssetDTO: a document's
                  stored delivery URL is not fetchable on its own. */}
              <a
                href={item.asset.viewUrl ?? item.asset.secureUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex size-5 items-center justify-center rounded-full text-white hover:bg-white/20"
                aria-label="View"
              >
                <ExternalLink className="size-3" />
              </a>

              {item.asset.downloadUrl && (
                <a
                  href={item.asset.downloadUrl}
                  className="flex size-5 items-center justify-center rounded-full text-white hover:bg-white/20"
                  aria-label="Download"
                >
                  <Download className="size-3" />
                </a>
              )}
            </div>

            {!readOnly && (
              <button
                type="button"
                onClick={() => handleRemove(item.assetId)}
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
        ))}

        {!readOnly &&
          pending.map((item) => (
            <div
              key={item.key}
              className="relative flex size-24 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border bg-muted p-2 text-center"
            >
              {item.error ? (
                <span className="text-xs text-destructive line-clamp-3">
                  {item.error}
                </span>
              ) : (
                <>
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  <span className="w-full truncate text-[10px] text-muted-foreground">
                    {item.fileName}
                  </span>
                </>
              )}
            </div>
          ))}

        {canAddMore && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex size-24 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-muted-foreground hover:bg-muted/60"
          >
            <Plus className="size-5" />
            <span className="text-xs">Add</span>
          </button>
        )}

        {assets.length === 0 && pending.length === 0 && readOnly && (
          <p className="text-sm text-muted-foreground">
            No supporting material was attached.
          </p>
        )}
      </div>

      {!readOnly && (
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          multiple
          hidden
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = "";
          }}
        />
      )}
    </div>
  );
}
