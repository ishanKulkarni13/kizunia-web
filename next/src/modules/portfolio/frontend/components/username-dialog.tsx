"use client";

/**
 * Portfolio Module - Username Dialog
 *
 * A Portfolio's public URL is keyed by the owner's `User.username` (Better
 * Auth's `username` plugin), not a Portfolio-owned slug. This dialog is the
 * minimum UI needed to set or change it from within the Portfolio flows:
 * shown before creation when the actor has no username yet, and from the
 * "Change Username" action in the editor. It intentionally does not
 * introduce a second username system — every submission goes through
 * `authClient.updateUser`, the same Better Auth endpoint the rest of the
 * app would use for account fields.
 */

import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface UsernameDialogProps {
  readonly open: boolean;

  readonly onOpenChange: (open: boolean) => void;

  readonly title: string;

  readonly description: string;

  readonly submitLabel: string;

  /** Pre-filled when changing an existing username. */
  readonly initialUsername?: string;

  /**
   * Called once the username has been saved. Better Auth's client already
   * refreshes the session in the background after `/update-user`, so this
   * is only for the caller's own follow-up (e.g. continuing portfolio
   * creation) — not for updating any username display itself.
   */
  readonly onSuccess?: (username: string) => void;
}

export function UsernameDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  initialUsername = "",
  onSuccess,
}: UsernameDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>

          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {/*
          A child so that closing the dialog unmounts it, resetting the
          draft and any error message instead of leaving stale state
          around for the next open.
        */}
        <UsernameForm
          key={initialUsername}
          initialUsername={initialUsername}
          submitLabel={submitLabel}
          onCancel={() => onOpenChange(false)}
          onDone={(username) => {
            onOpenChange(false);
            onSuccess?.(username);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function UsernameForm({
  initialUsername,
  submitLabel,
  onCancel,
  onDone,
}: {
  initialUsername: string;
  submitLabel: string;
  onCancel: () => void;
  onDone: (username: string) => void;
}) {
  const [username, setUsername] = useState(initialUsername);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = username.trim();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (trimmed.length === 0 || submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);

    const { error: updateError } = await authClient.updateUser({
      username: trimmed,
    });

    setSubmitting(false);

    if (updateError) {
      // Better Auth's username plugin already returns a human-readable
      // message for the cases that matter here (taken, too short, too
      // long, invalid characters) — no need to re-map error codes.
      setError(updateError.message ?? "Could not update username.");
      return;
    }

    onDone(trimmed);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-2 pt-4">
        <Label htmlFor="portfolio-username">Username</Label>

        <Input
          id="portfolio-username"
          value={username}
          autoFocus
          maxLength={30}
          onChange={(event) => {
            setUsername(event.target.value);
            setError(null);
          }}
          placeholder="yourname"
        />

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="h-4" />

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>

        <Button type="submit" disabled={trimmed.length === 0 || submitting}>
          {submitting ? "Saving..." : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
