"use client";

import { useState } from "react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { LinkType } from "@/generated/prisma";
import { LINK_TYPE_META } from "@/modules/links";
import { CreateProjectLinkSchema } from "../../../../schemas/project-link.schema";
import type { ProjectLinkDto } from "../../../../backend/dto/output";

export interface LinkFormValues {
  title: string;
  url: string;
  type: LinkType;
}

const EMPTY_FORM: LinkFormValues = {
  title: "",
  url: "",
  type: LinkType.WEBSITE,
};

type FieldErrors = Partial<Record<keyof LinkFormValues, string>>;

interface LinkFormDialogProps {
  trigger: React.ReactNode;
  link?: ProjectLinkDto;
  busy: boolean;
  onSubmit: (values: LinkFormValues) => Promise<void>;
}

export function LinkFormDialog({
  trigger,
  link,
  busy,
  onSubmit,
}: LinkFormDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent>
        {/* Mounted only while open, so its form state always starts fresh
            from `link` instead of being reset via an effect. */}
        {open && (
          <LinkFormFields
            link={link}
            busy={busy}
            onCancel={() => setOpen(false)}
            onSubmit={async (values) => {
              await onSubmit(values);
              setOpen(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface LinkFormFieldsProps {
  link?: ProjectLinkDto;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (values: LinkFormValues) => Promise<void>;
}

function LinkFormFields({
  link,
  busy,
  onCancel,
  onSubmit,
}: LinkFormFieldsProps) {
  const [form, setForm] = useState<LinkFormValues>(
    link
      ? { title: link.title, url: link.url, type: link.type }
      : EMPTY_FORM,
  );

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function handleSubmit() {
    const validation = CreateProjectLinkSchema.safeParse(form);

    if (!validation.success) {
      const errors: FieldErrors = {};

      for (const issue of validation.error.issues) {
        const key = issue.path[0] as keyof LinkFormValues | undefined;

        if (key && !errors[key]) {
          errors[key] = issue.message;
        }
      }

      setFieldErrors(errors);

      return;
    }

    await onSubmit(validation.data);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{link ? "Edit link" : "Add link"}</DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="link-title">Title</Label>

          <Input
            id="link-title"
            value={form.title}
            disabled={busy}
            placeholder="Frontend Repository"
            onChange={(event) =>
              setForm((prev) => ({ ...prev, title: event.target.value }))
            }
            aria-invalid={Boolean(fieldErrors.title)}
          />

          {fieldErrors.title && (
            <p className="text-xs text-destructive">{fieldErrors.title}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="link-url">URL</Label>

          <Input
            id="link-url"
            value={form.url}
            disabled={busy}
            placeholder="https://github.com/example/repo"
            onChange={(event) =>
              setForm((prev) => ({ ...prev, url: event.target.value }))
            }
            aria-invalid={Boolean(fieldErrors.url)}
          />

          {fieldErrors.url && (
            <p className="text-xs text-destructive">{fieldErrors.url}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="link-type">Type</Label>

          <Select
            value={form.type}
            disabled={busy}
            onValueChange={(value) =>
              setForm((prev) => ({ ...prev, type: value as LinkType }))
            }
          >
            <SelectTrigger id="link-type" className="w-full">
              <SelectValue />
            </SelectTrigger>

            <SelectContent>
              {Object.entries(LINK_TYPE_META).map(([type, meta]) => (
                <SelectItem key={type} value={type}>
                  <span className="flex items-center gap-2">
                    <meta.icon className="size-4" />

                    {meta.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          {busy ? "Saving..." : link ? "Save changes" : "Add link"}
        </Button>
      </DialogFooter>
    </>
  );
}
