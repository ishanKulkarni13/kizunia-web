"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface ReasonDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly destructive?: boolean;
  /** Runs the action with the trimmed reason. Throwing keeps the dialog open; the caller shows the error. */
  readonly onConfirm: (reason: string) => Promise<void>;
}

/**
 * A recorded admin action asks for a reason (3–500 characters, the same rule
 * as grants). The length hint here is convenience; the API is the authority.
 */
export function ReasonDialog({ open, onOpenChange, title, description, confirmLabel, destructive, onConfirm }: ReasonDialogProps) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);

    try {
      await onConfirm(reason.trim());
      setReason("");
      onOpenChange(false);
    } catch {
      // The caller has already reported the error; keep the dialog and the typed reason.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setReason("");
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1">
            <Label htmlFor="reason-dialog-reason">Reason</Label>
            <Textarea
              id="reason-dialog-reason"
              required
              minLength={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why is this being done? It is recorded with your name."
            />
          </div>

          <DialogFooter>
            <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={busy || reason.trim().length < 3}>
              {busy ? "Working…" : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
