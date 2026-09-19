"use client";

import { useState } from "react";
import Image from "next/image";
import { ImageIcon, Pencil, Star } from "lucide-react";

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
import { ImageUploaderDialog } from "@/components/cloudinary/imageUploader/image-uploader-dialog";

import { AddPortfolioTestimonialSchema } from "../../../../schemas/portfolio-testimonial.schema";
import type { PortfolioTestimonialSummaryDto } from "../../../../dtos";

export interface TestimonialFormValues {
  name: string;
  position: string | null;
  company: string | null;
  message: string;
  rating: number | null;
  imageAssetId: string | null;
}

function toEmptyForm(): TestimonialFormValues {
  return {
    name: "",
    position: null,
    company: null,
    message: "",
    rating: null,
    imageAssetId: null,
  };
}

function toFormValues(
  testimonial: PortfolioTestimonialSummaryDto,
): TestimonialFormValues {
  return {
    name: testimonial.name,
    position: testimonial.position,
    company: testimonial.company,
    message: testimonial.message,
    rating: testimonial.rating,
    imageAssetId: testimonial.image?.id ?? null,
  };
}

type FieldErrors = Partial<
  Record<"name" | "position" | "company" | "message" | "rating", string>
>;

interface TestimonialFormDialogProps {
  trigger: React.ReactNode;
  /** The acting user's own portfolio id — used only to satisfy the image
   * uploader's target-entity wiring. Authorization for
   * PORTFOLIO_TESTIMONIAL_IMAGE always resolves the actor's own portfolio
   * server-side, never trusting this value. */
  portfolioId: string;
  testimonial?: PortfolioTestimonialSummaryDto;
  busy: boolean;
  onSubmit: (values: TestimonialFormValues) => Promise<void>;
}

export function TestimonialFormDialog({
  trigger,
  portfolioId,
  testimonial,
  busy,
  onSubmit,
}: TestimonialFormDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        {/* Mounted only while open, so its form state always starts fresh
            from `testimonial` instead of being reset via an effect. */}
        {open && (
          <TestimonialFormFields
            portfolioId={portfolioId}
            testimonial={testimonial}
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

interface TestimonialFormFieldsProps {
  portfolioId: string;
  testimonial?: PortfolioTestimonialSummaryDto;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (values: TestimonialFormValues) => Promise<void>;
}

function TestimonialFormFields({
  portfolioId,
  testimonial,
  busy,
  onCancel,
  onSubmit,
}: TestimonialFormFieldsProps) {
  const [form, setForm] = useState<TestimonialFormValues>(
    testimonial ? toFormValues(testimonial) : toEmptyForm(),
  );

  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(
    testimonial?.image?.url ?? null,
  );

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function handleSubmit() {
    const validation = AddPortfolioTestimonialSchema.safeParse({
      name: form.name,
      position: form.position,
      company: form.company,
      message: form.message,
      rating: form.rating,
      imageAssetId: form.imageAssetId,
    });

    if (!validation.success) {
      const errors: FieldErrors = {};

      for (const issue of validation.error.issues) {
        const key = issue.path[0] as keyof FieldErrors | undefined;

        if (key && !errors[key]) {
          errors[key] = issue.message;
        }
      }

      setFieldErrors(errors);

      return;
    }

    await onSubmit(form);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {testimonial ? "Edit testimonial" : "Add testimonial"}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Photo</Label>

          <div className="relative size-16">
            {imagePreviewUrl ? (
              <Image
                src={imagePreviewUrl}
                alt=""
                fill
                sizes="64px"
                className="rounded-full border object-cover"
              />
            ) : (
              <div className="flex size-16 items-center justify-center rounded-full border bg-muted">
                <ImageIcon className="size-5 text-muted-foreground" />
              </div>
            )}

            <ImageUploaderDialog
              dialogTitle="Testimonial photo"
              contentClassName="sm:max-w-lg"
              title="Testimonial photo"
              initialImage={imagePreviewUrl ?? ""}
              purpose="PORTFOLIO_TESTIMONIAL_IMAGE"
              targetEntityId={portfolioId}
              customCropShape="round"
              aspectRatio={1}
              accept="image/*"
              onUpload={async (url, asset) => {
                if (!asset) return;

                setImagePreviewUrl(url);
                setForm((prev) => ({ ...prev, imageAssetId: asset.id }));
              }}
              onDelete={() => {
                setImagePreviewUrl(null);
                setForm((prev) => ({ ...prev, imageAssetId: null }));
              }}
            >
              <Button
                type="button"
                variant="secondary"
                size="icon-sm"
                aria-label="Edit testimonial photo"
                className="absolute -bottom-1 -right-1 rounded-full shadow"
              >
                <Pencil className="size-3.5" />
              </Button>
            </ImageUploaderDialog>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="testimonial-name">Name</Label>

          <Input
            id="testimonial-name"
            value={form.name}
            disabled={busy}
            placeholder="Jane Doe"
            onChange={(event) =>
              setForm((prev) => ({ ...prev, name: event.target.value }))
            }
            aria-invalid={Boolean(fieldErrors.name)}
          />

          {fieldErrors.name && (
            <p className="text-xs text-destructive">{fieldErrors.name}</p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="testimonial-position">Position</Label>

            <Input
              id="testimonial-position"
              value={form.position ?? ""}
              disabled={busy}
              placeholder="Product Manager"
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  position: event.target.value || null,
                }))
              }
              aria-invalid={Boolean(fieldErrors.position)}
            />

            {fieldErrors.position && (
              <p className="text-xs text-destructive">
                {fieldErrors.position}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="testimonial-company">Company</Label>

            <Input
              id="testimonial-company"
              value={form.company ?? ""}
              disabled={busy}
              placeholder="Acme Inc."
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  company: event.target.value || null,
                }))
              }
              aria-invalid={Boolean(fieldErrors.company)}
            />

            {fieldErrors.company && (
              <p className="text-xs text-destructive">
                {fieldErrors.company}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="testimonial-message">Testimonial</Label>

          <Textarea
            id="testimonial-message"
            value={form.message}
            disabled={busy}
            rows={4}
            placeholder="What did they say about working with you?"
            onChange={(event) =>
              setForm((prev) => ({ ...prev, message: event.target.value }))
            }
            aria-invalid={Boolean(fieldErrors.message)}
          />

          {fieldErrors.message && (
            <p className="text-xs text-destructive">{fieldErrors.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Rating</Label>

          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                disabled={busy}
                aria-label={`Rate ${value} out of 5`}
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    rating: prev.rating === value ? null : value,
                  }))
                }
              >
                <Star
                  className={
                    form.rating !== null && value <= form.rating
                      ? "size-5 fill-yellow-400 text-yellow-400"
                      : "size-5 text-muted-foreground"
                  }
                />
              </button>
            ))}

            {form.rating !== null && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setForm((prev) => ({ ...prev, rating: null }))}
              >
                Clear
              </Button>
            )}
          </div>
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
          {busy ? "Saving..." : testimonial ? "Save changes" : "Add testimonial"}
        </Button>
      </DialogFooter>
    </>
  );
}
