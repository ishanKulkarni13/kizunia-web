"use client";

/**
 * DocumentUploader
 *
 * Deliberately simple, per docs/architecture/domain/assets/upload.md: a
 * resume upload does not need the platform to render or inspect the
 * document — only to accept it, validate it against policy, and report
 * whether the upload succeeded.
 *
 * Provides: drag/drop, browse/select, an uploading/loading state, progress,
 * a success state, and an error state.
 *
 * Deliberately does NOT provide: a preview, page-count extraction/display,
 * document rendering, or an editor.
 */

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";

import { Progress } from "@/components/ui/progress";
import { getErrorMessage } from "@/utils/error";

import { useAssetUpload } from "../hooks/use-asset-upload";
import type { AssetDTO, AssetPurpose } from "../types";

type UploadState = "idle" | "uploading" | "success" | "error";

interface DocumentUploaderProps {
  purpose: AssetPurpose;
  targetEntityType?: string;
  targetEntityId?: string;
  /** MIME type accepted by the file picker/dropzone — a UX hint only. The
   * backend policy for `purpose` is the actual authority. */
  accept?: string;
  onUploaded?: (asset: AssetDTO) => void | Promise<void>;
}

export function DocumentUploader({
  purpose,
  targetEntityType,
  targetEntityId,
  accept = "application/pdf",
  onUploaded,
}: DocumentUploaderProps) {
  const { upload, progress } = useAssetUpload({
    purpose,
    targetEntityType,
    targetEntityId,
  });

  const [state, setState] = useState<UploadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setFileName(file.name);
      setState("uploading");
      setErrorMessage(null);

      try {
        const asset = await upload(file);

        setState("success");

        await onUploaded?.(asset);
      } catch (error) {
        setState("error");
        setErrorMessage(getErrorMessage(error));
      }
    },
    [upload, onUploaded],
  );

  const onDrop = useCallback(
    (accepted: File[]) => {
      const file = accepted[0];

      if (file) {
        void handleFile(file);
      }
    },
    [handleFile],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    accept: { [accept]: [] },
  });

  return (
    <div className="flex flex-col gap-3 w-full">
      <div
        {...getRootProps()}
        className={`w-full rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition
          bg-muted/40 hover:bg-muted/60 border-primary/60
          ${isDragActive ? "ring-2 ring-primary" : ""}`}
      >
        <input {...getInputProps()} />
        {isDragActive ? (
          <p className="text-sm font-medium text-primary">Drop the file here...</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Drag &amp; drop a file here, or{" "}
            <span className="underline text-primary font-semibold">Browse</span>
          </p>
        )}
      </div>

      {fileName && (
        <p className="text-xs text-muted-foreground truncate">{fileName}</p>
      )}

      {state === "uploading" && (
        <div className="w-full space-y-1">
          <Progress value={progress} />
          <p className="text-xs text-muted-foreground text-center">
            Uploading {progress}%
          </p>
        </div>
      )}

      {state === "success" && (
        <p className="text-sm text-green-600">Upload successful.</p>
      )}

      {state === "error" && (
        <p className="text-sm text-destructive">
          {errorMessage ?? "Upload failed."}
        </p>
      )}
    </div>
  );
}

export default DocumentUploader;
