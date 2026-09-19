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

interface RemoveTestimonialConfirmProps {
  testimonialName: string;

  busy: boolean;

  trigger: ReactNode;

  onConfirm: () => void;
}

export function RemoveTestimonialConfirm({
  testimonialName,
  busy,
  trigger,
  onConfirm,
}: RemoveTestimonialConfirmProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>

      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this testimonial?</AlertDialogTitle>

          <AlertDialogDescription>
            The testimonial from &ldquo;{testimonialName}&rdquo; will be
            permanently deleted. This cannot be undone.
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
