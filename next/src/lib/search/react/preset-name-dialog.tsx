"use client";

/**
 * Search Core (React) - Naming a saved preset
 *
 * One dialog for both saving and renaming, because they ask the same question
 * and differ only in what happens to the answer. Two dialogs would be two
 * places to fix the next time the validation rules move.
 *
 * The parent owns whether it is open and what to do with the name; this
 * component owns the draft, the length rule and the failure message, so a
 * caller cannot forget any of the three.
 */

import { useState, type FormEvent, type ReactNode } from "react";

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

import { PRESET_NAME_MAX_LENGTH } from "../preset-storage";

export interface PresetNameDialogProps {
  readonly open: boolean;

  readonly onOpenChange: (open: boolean) => void;

  readonly title: string;

  readonly description: string;

  readonly submitLabel: string;

  /** Pre-filled when renaming; empty when saving something new. */
  readonly initialName?: string;

  /**
   * Shown under the name field — what saving will actually record.
   *
   * A preset is invisible once it has a name: a month later "My AI stuff" says
   * nothing about which filters are inside it. Showing them at the moment of
   * naming is the one chance to make the name and its contents agree, and it
   * is also how someone learns what a preset *is* without being told.
   */
  readonly details?: ReactNode;

  /**
   * Returns whether the name was accepted.
   *
   * A rejection keeps the dialog open with the text intact — storage can
   * refuse a write, and closing the dialog on failure would look exactly like
   * success right up until the preset was not there.
   */
  readonly onSubmit: (name: string) => boolean;
}

export function PresetNameDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  initialName = "",
  details,
  onSubmit,
}: PresetNameDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>

          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {/*
          The form is a child so that closing the dialog unmounts it, which is
          what resets the draft and any failure message. Seeding that state
          from an effect instead would re-render on every open and leave the
          previous preset's name on screen for a frame.
        */}
        <PresetNameForm
          initialName={initialName}
          submitLabel={submitLabel}
          details={details}
          onSubmit={onSubmit}
          onCancel={() => onOpenChange(false)}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function PresetNameForm({
  initialName,
  submitLabel,
  details,
  onSubmit,
  onCancel,
  onDone,
}: {
  initialName: string;
  submitLabel: string;
  details?: ReactNode;
  onSubmit: (name: string) => boolean;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [failed, setFailed] = useState(false);

  const trimmed = name.trim();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (trimmed.length === 0) {
      return;
    }

    if (onSubmit(trimmed)) {
      onDone();
      return;
    }

    setFailed(true);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-2 pt-4">
        <Label htmlFor="preset-name">Preset name</Label>

        <Input
          id="preset-name"
          value={name}
          autoFocus
          maxLength={PRESET_NAME_MAX_LENGTH}
          onChange={(event) => setName(event.target.value)}
          placeholder="Weekend hackathons near me"
        />

        {failed && (
          <p className="text-sm text-destructive" role="alert">
            That could not be saved. Your browser may be blocking local storage,
            or you may have reached the limit on saved presets.
          </p>
        )}
      </div>

      {details && <div className="pt-5">{details}</div>}

      <div className="h-4" />

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>

        <Button type="submit" disabled={trimmed.length === 0}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
