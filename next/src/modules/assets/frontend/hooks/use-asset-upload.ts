"use client";

import { useCallback, useState } from "react";

import { AssetApi } from "../api/asset-api";
import type { AssetDTO, AssetPurpose } from "../types";
import { uploadFileToProvider } from "./upload-to-provider";

export interface UseAssetUploadOptions {
  purpose: AssetPurpose;
  targetEntityType?: string;
  targetEntityId?: string;
}

/**
 * Shared upload infrastructure behind every specialized uploader
 * (ReusableImageUploader, DocumentUploader, ...). Requests an UploadIntent,
 * uploads directly to the provider using only the authorization the backend
 * issued, then finalizes — returning the resulting Asset. No Cloudinary
 * type ever crosses this boundary; see
 * docs/architecture/domain/assets/upload.md.
 */
export function useAssetUpload({
  purpose,
  targetEntityType,
  targetEntityId,
}: UseAssetUploadOptions) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (file: Blob & { type?: string }): Promise<AssetDTO> => {
      setUploading(true);
      setProgress(0);
      setError(null);

      try {
        const declaredMimeType = file.type || "application/octet-stream";

        const intent = await AssetApi.createUploadIntent({
          purpose,
          targetEntityType,
          targetEntityId,
          declaredMimeType,
          declaredSize: file.size,
        });

        await uploadFileToProvider({
          uploadUrl: intent.uploadUrl,
          params: intent.params,
          file,
          onProgress: setProgress,
        });

        const asset = await AssetApi.finalize(intent.intentId);

        setProgress(100);

        return asset;
      } catch (e) {
        const message = e instanceof Error ? e.message : "Upload failed.";

        setError(message);

        throw e;
      } finally {
        setUploading(false);
      }
    },
    [purpose, targetEntityType, targetEntityId],
  );

  return { upload, uploading, progress, error };
}
