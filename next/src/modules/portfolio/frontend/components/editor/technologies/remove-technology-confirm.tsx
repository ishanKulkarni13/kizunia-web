"use client";

import type { ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface RemoveTechnologyConfirmProps {
  technologyName: string;

  busy: boolean;

  trigger: ReactNode;

  onConfirm: () => void;
}

export function RemoveTechnologyConfirm({
  technologyName,
  busy,
  trigger,
  onConfirm,
}: RemoveTechnologyConfirmProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>

      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Remove this technology from your portfolio?
          </AlertDialogTitle>

          <AlertDialogDescription>
            &ldquo;{technologyName}&rdquo; will no longer appear in your
            portfolio. You can add it back at any time.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>

          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={onConfirm}
          >
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
