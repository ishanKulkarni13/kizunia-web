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

interface RemoveProjectConfirmProps {
  projectTitle: string;

  busy: boolean;

  trigger: ReactNode;

  onConfirm: () => void;
}

export function RemoveProjectConfirm({
  projectTitle,
  busy,
  trigger,
  onConfirm,
}: RemoveProjectConfirmProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>

      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this project from your portfolio?</AlertDialogTitle>

          <AlertDialogDescription>
            &ldquo;{projectTitle}&rdquo; will no longer appear in your
            portfolio. This only removes the project from your portfolio —
            the project itself, its members and its content will not be
            deleted, and you can add it back at any time.
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
