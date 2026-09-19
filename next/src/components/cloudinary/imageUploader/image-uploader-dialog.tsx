"use client";

import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import ReusableImageUploader, {
  type ReusableImageUploaderProps,
} from "@/components/cloudinary/imageUploader/reusableImageUploader";

type ImageUploaderDialogProps = {
  /** Trigger element rendered as-is; clicking it opens the dialog. */
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Escape hatch to widen DialogContent for the crop UI. */
  contentClassName?: string;
  dialogTitle: string;
} & Pick<
  ReusableImageUploaderProps,
  | "purpose"
  | "title"
  | "initialImage"
  | "onUpload"
  | "onDelete"
  | "customCropShape"
  | "aspectRatio"
  | "accept"
  | "targetEntityId"
  | "targetEntityType"
  | "gallery"
>;

/**
 * Generic dialog wrapper around ReusableImageUploader. Contains no
 * caller-specific logic — it only owns open/close state and forwards it as
 * ReusableImageUploader's `setOpen`, which the uploader already calls on
 * success (upload/gallery-select/delete) and leaves untouched on failure.
 */
export function ImageUploaderDialog({
  children,
  open,
  onOpenChange,
  contentClassName,
  dialogTitle,
  ...uploaderProps
}: ImageUploaderDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);

  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>

      <DialogContent className={contentClassName}>
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>

        <ReusableImageUploader {...uploaderProps} setOpen={setOpen} />
      </DialogContent>
    </Dialog>
  );
}
