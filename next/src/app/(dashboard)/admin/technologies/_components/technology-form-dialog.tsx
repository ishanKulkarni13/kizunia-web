"use client";

/**
 * Admin Technologies - Create/Edit dialog
 *
 * A single dialog reused for both create and edit, matching the spec's call
 * for a small-field-count Dialog form rather than a full tabbed editor like
 * Competition's. Two things are deliberately kept as separate actions
 * instead of folding into one "save everything" button:
 *
 *  - Name/type/description vs. slug: the backend exposes these as two
 *    different endpoints (`PATCH /technologies/[id]` vs.
 *    `PATCH /technologies/[id]/slug`) specifically so editing the name can
 *    never silently change the slug. The UI mirrors that split with its own
 *    "Edit slug" affordance, separate from the main Save button.
 *  - The icon uploader: only meaningful once the Technology has an id, so on
 *    create it stays disabled until the initial create succeeds (simplest
 *    option per the task spec, rather than create-then-reopen).
 */

import { useState } from "react";
import { toast } from "sonner";
import { PencilIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ReusableImageUploader from "@/components/cloudinary/imageUploader/reusableImageUploader";
import { ApiError } from "@/lib/http";
import { TechnologyType } from "@/generated/prisma";

import { TechnologyApi } from "@/modules/technologies/api/technology-api";
import type { TechnologyAdminDTO } from "@/modules/technologies/backend/dto/technology-admin.dto";

const TYPE_OPTIONS: { value: TechnologyType; label: string }[] = [
  { value: TechnologyType.LANGUAGE, label: "Language" },
  { value: TechnologyType.FRAMEWORK, label: "Framework" },
  { value: TechnologyType.LIBRARY, label: "Library" },
  { value: TechnologyType.DATABASE, label: "Database" },
  { value: TechnologyType.RUNTIME, label: "Runtime" },
  { value: TechnologyType.TOOL, label: "Tool" },
  { value: TechnologyType.PLATFORM, label: "Platform" },
  { value: TechnologyType.SERVICE, label: "Service" },
  { value: TechnologyType.OTHER, label: "Other" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present for edit, absent for create. */
  technology?: TechnologyAdminDTO;
  onSaved: (technology: TechnologyAdminDTO) => void;
}

export function TechnologyFormDialog({
  open,
  onOpenChange,
  technology,
  onSaved,
}: Props) {
  const isEdit = !!technology;

  // Local mutable copy so a create-then-icon-upload flow (and slug edits)
  // can update what's shown without waiting on the parent to re-render.
  const [current, setCurrent] = useState<TechnologyAdminDTO | undefined>(
    technology,
  );

  const [name, setName] = useState(technology?.name ?? "");
  const [type, setType] = useState<TechnologyType>(
    technology?.type ?? TechnologyType.OTHER,
  );
  const [description, setDescription] = useState(
    technology?.description ?? "",
  );
  const [saving, setSaving] = useState(false);

  const [editingSlug, setEditingSlug] = useState(false);
  const [slugDraft, setSlugDraft] = useState(technology?.slug ?? "");
  const [savingSlug, setSavingSlug] = useState(false);

  function resetForNextOpen() {
    setCurrent(undefined);
    setName("");
    setType(TechnologyType.OTHER);
    setDescription("");
    setEditingSlug(false);
    setSlugDraft("");
  }

  async function handleSave() {
    if (name.trim().length < 2) {
      toast.error("Name must be at least 2 characters.");
      return;
    }

    try {
      setSaving(true);

      const saved = current
        ? await TechnologyApi.updateFields(current.id, {
            name,
            type,
            description: description.trim().length ? description : null,
          })
        : await TechnologyApi.create({
            name,
            type,
            description: description.trim().length ? description : undefined,
          });

      setCurrent(saved);
      onSaved(saved);
      toast.success(current ? "Technology updated." : "Technology created.");

      if (!current) {
        // Stay open so the icon uploader (which needs an id) becomes usable.
        setSlugDraft(saved.slug);
      } else {
        onOpenChange(false);
      }
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Could not save that.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveSlug() {
    if (!current) return;

    if (slugDraft.trim().length === 0) {
      toast.error("Slug cannot be empty.");
      return;
    }

    try {
      setSavingSlug(true);

      const saved = await TechnologyApi.updateSlug(current.id, slugDraft.trim());

      setCurrent(saved);
      onSaved(saved);
      setEditingSlug(false);
      toast.success("Slug updated.");
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Could not update the slug.",
      );
    } finally {
      setSavingSlug(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) resetForNextOpen();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit technology" : "Create technology"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update this technology's name, type or description."
              : "Add a new entry to the global technology taxonomy."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tech-name">Name</Label>
            <Input
              id="tech-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. TypeScript"
            />
          </div>

          {current && (
            <div className="space-y-1.5">
              <Label>Slug</Label>
              {editingSlug ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={slugDraft}
                    onChange={(e) => setSlugDraft(e.target.value)}
                    placeholder="e.g. typescript"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={savingSlug}
                    onClick={handleSaveSlug}
                  >
                    Save
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={savingSlug}
                    onClick={() => {
                      setEditingSlug(false);
                      setSlugDraft(current.slug);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                    {current.slug}
                  </span>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Edit slug"
                    onClick={() => {
                      setSlugDraft(current.slug);
                      setEditingSlug(true);
                    }}
                  >
                    <PencilIcon className="size-3.5" />
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Editing the slug is a separate action from saving the fields
                below — it never happens implicitly.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="tech-type">Type</Label>
            <Select
              value={type}
              onValueChange={(value) => setType(value as TechnologyType)}
            >
              <SelectTrigger id="tech-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tech-description">Description</Label>
            <Textarea
              id="tech-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Icon</Label>
            {current ? (
              <ReusableImageUploader
                title=""
                initialImage={current.iconAsset?.secureUrl ?? ""}
                purpose="TECHNOLOGY_ICON"
                targetEntityId={current.id}
                customCropShape="rect"
                accept="image/*"
                onUpload={async (_, asset) => {
                  if (!asset) return;

                  try {
                    const updated = await TechnologyApi.setIcon(current.id, {
                      assetId: asset.id,
                    });

                    setCurrent(updated);
                    onSaved(updated);
                    toast.success("Icon updated.");
                  } catch (error) {
                    toast.error(
                      error instanceof ApiError
                        ? error.message
                        : "Failed to update icon.",
                    );
                  }
                }}
                onDelete={async () => {
                  const updated = await TechnologyApi.clearIcon(current.id);

                  setCurrent(updated);
                  onSaved(updated);
                }}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                Save the technology first to add an icon.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" disabled={saving} onClick={handleSave}>
            {current ? "Save changes" : "Create technology"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
