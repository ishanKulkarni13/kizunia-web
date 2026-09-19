"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import type { PortfolioTechnologySummaryDto } from "../../../../dtos";
import type { UpdatePortfolioTechnologyInput } from "../../../../schemas/portfolio-technology.schema";

/** `Date` -> `yyyy-mm-dd` for an `<input type="date">`. */
// function toDateInputValue(date: Date | null): string {
//   if (!date) {
//     return "";
//   }

//   return date.toISOString().slice(0, 10);
// }

function toDateInputValue(date: string | null) {
  if (!date) return "";

  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return "";
  }

  return parsedDate.toISOString().slice(0, 10);
}

interface EditTechnologyMetadataDialogProps {
  technology: PortfolioTechnologySummaryDto;

  busy: boolean;

  onSubmit: (dto: UpdatePortfolioTechnologyInput) => Promise<void>;
}

export function EditTechnologyMetadataDialog({
  technology,
  busy,
  onSubmit,
}: EditTechnologyMetadataDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={busy}
          aria-label="Edit technology details"
        >
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        {/* Mounted only while open, so its form state always starts fresh
         * from `technology` instead of being reset via an effect. */}
        {open && (
          <EditTechnologyMetadataFields
            technology={technology}
            busy={busy}
            onCancel={() => setOpen(false)}
            onSubmit={async (dto) => {
              await onSubmit(dto);
              setOpen(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditTechnologyMetadataFields({
  technology,
  busy,
  onCancel,
  onSubmit,
}: {
  technology: PortfolioTechnologySummaryDto;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (dto: UpdatePortfolioTechnologyInput) => Promise<void>;
}) {
  const [startedUsingAt, setStartedUsingAt] = useState(
    toDateInputValue(technology.startedUsingAt),
  );

  const [description, setDescription] = useState(technology.description ?? "");

  async function handleSubmit() {
    await onSubmit({
      startedUsingAt: startedUsingAt ? new Date(startedUsingAt) : null,
      description: description.trim() || null,
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{technology.name}</DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="edit-technology-started-using-at">
            Started using
          </Label>

          <Input
            id="edit-technology-started-using-at"
            type="date"
            value={startedUsingAt}
            disabled={busy}
            onChange={(event) => setStartedUsingAt(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="edit-technology-description">Description</Label>

          <Textarea
            id="edit-technology-description"
            value={description}
            disabled={busy}
            rows={3}
            placeholder="How do you use this technology?"
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </Button>

        <Button type="button" disabled={busy} onClick={() => void handleSubmit()}>
          {busy ? "Saving..." : "Save changes"}
        </Button>
      </DialogFooter>
    </>
  );
}
