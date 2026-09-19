"use client";

/**
 * Shared Reject / Request-Changes dialog.
 *
 * Modeled on `src/lib/search/react/preset-name-dialog.tsx`'s controlled-open
 * + form-as-child-that-unmounts-on-close pattern, but the reason here is
 * genuinely optional: unlike that dialog, submit is never disabled on an
 * empty value.
 */

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface ReviewReasonDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly confirmVariant?: "default" | "destructive";
  readonly onConfirm: (reason: string | undefined) => Promise<void>;
}

export function ReviewReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  confirmVariant = "default",
  onConfirm,
}: ReviewReasonDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <ReviewReasonForm
          confirmLabel={confirmLabel}
          confirmVariant={confirmVariant}
          onConfirm={onConfirm}
          onCancel={() => onOpenChange(false)}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ReviewReasonForm({
  confirmLabel,
  confirmVariant,
  onConfirm,
  onCancel,
  onDone,
}: {
  confirmLabel: string;
  confirmVariant: "default" | "destructive";
  onConfirm: (reason: string | undefined) => Promise<void>;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    setSubmitting(true);

    try {
      const trimmed = reason.trim();

      await onConfirm(trimmed.length > 0 ? trimmed : undefined);

      onDone();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-2 pt-4">
        <Label htmlFor="review-reason">Reason (optional)</Label>

        <Textarea
          id="review-reason"
          value={reason}
          autoFocus
          rows={4}
          onChange={(event) => setReason(event.target.value)}
          placeholder="The contributor will see this."
        />
      </div>

      <div className="h-4" />

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>

        <Button type="submit" variant={confirmVariant} disabled={submitting}>
          {submitting ? "Submitting..." : confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
