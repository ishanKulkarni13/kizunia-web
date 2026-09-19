"use client";

import { useEffect } from "react";
import Image from "next/image";
import {
  ArrowDown,
  ArrowUp,
  MessageSquareQuote,
  Pencil,
  Plus,
  Star,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";

import { usePortfolioStore } from "../../../store/portfolio.store";
import { usePortfolioTestimonialsStore } from "../../../store/portfolio-testimonials.store";
import {
  TestimonialFormDialog,
  type TestimonialFormValues,
} from "./testimonial-form-dialog";
import { RemoveTestimonialConfirm } from "./remove-testimonial-confirm";

export function PortfolioTestimonialsTab() {
  const portfolio = usePortfolioStore((state) => state.portfolio);

  const testimonials = usePortfolioTestimonialsStore(
    (state) => state.testimonials,
  );

  const isLoading = usePortfolioTestimonialsStore((state) => state.isLoading);

  const busy = usePortfolioTestimonialsStore((state) => state.busy);

  const error = usePortfolioTestimonialsStore((state) => state.error);

  const initialize = usePortfolioTestimonialsStore(
    (state) => state.initialize,
  );

  const createTestimonial = usePortfolioTestimonialsStore(
    (state) => state.createTestimonial,
  );

  const updateTestimonial = usePortfolioTestimonialsStore(
    (state) => state.updateTestimonial,
  );

  const deleteTestimonial = usePortfolioTestimonialsStore(
    (state) => state.deleteTestimonial,
  );

  const reorderTestimonials = usePortfolioTestimonialsStore(
    (state) => state.reorderTestimonials,
  );

  useEffect(() => {
    if (!portfolio) {
      return;
    }

    void initialize({ portfolioId: portfolio.id });
  }, [portfolio, initialize]);

  if (!portfolio) {
    return (
      <div className="rounded-lg border p-6">
        <p className="text-sm text-muted-foreground">
          Portfolio data is unavailable.
        </p>
      </div>
    );
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;

    if (target < 0 || target >= testimonials.length) {
      return;
    }

    const ids = testimonials.map((testimonial) => testimonial.id);

    [ids[index], ids[target]] = [ids[target], ids[index]];

    void reorderTestimonials(ids);
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Testimonials</h2>

          <p className="text-sm text-muted-foreground">
            Showcase feedback from people who&apos;ve worked with you.
          </p>
        </div>

        <TestimonialFormDialog
          portfolioId={portfolio.id}
          busy={busy}
          trigger={
            <Button type="button" size="sm">
              <Plus />
              Add testimonial
            </Button>
          }
          onSubmit={async (values: TestimonialFormValues) => {
            await createTestimonial(values);
          }}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((key) => (
            <div key={key} className="h-20 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : testimonials.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <MessageSquareQuote className="mx-auto mb-2 h-6 w-6" />
          No testimonials yet.
        </div>
      ) : (
        <div className="space-y-3">
          {testimonials.map((testimonial, index) => (
            <div
              key={testimonial.id}
              className="flex items-start gap-3 rounded-lg border p-3"
            >
              <div className="relative size-10 shrink-0">
                {testimonial.image?.url ? (
                  <Image
                    src={testimonial.image.url}
                    alt=""
                    fill
                    sizes="40px"
                    className="rounded-full border object-cover"
                  />
                ) : (
                  <div className="flex size-10 items-center justify-center rounded-full bg-muted text-xs font-medium">
                    {testimonial.name.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{testimonial.name}</p>

                <p className="truncate text-xs text-muted-foreground">
                  {[testimonial.position, testimonial.company]
                    .filter(Boolean)
                    .join(" · ")}
                </p>

                {testimonial.rating !== null && (
                  <div className="mt-1 flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <Star
                        key={value}
                        className={
                          value <= testimonial.rating!
                            ? "size-3.5 fill-yellow-400 text-yellow-400"
                            : "size-3.5 text-muted-foreground"
                        }
                      />
                    ))}
                  </div>
                )}

                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {testimonial.message}
                </p>
              </div>

              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={busy || index === 0}
                  onClick={() => move(index, -1)}
                  aria-label="Move testimonial up"
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  disabled={busy || index === testimonials.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label="Move testimonial down"
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>

                <TestimonialFormDialog
                  portfolioId={portfolio.id}
                  testimonial={testimonial}
                  busy={busy}
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      aria-label="Edit testimonial"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  }
                  onSubmit={async (values: TestimonialFormValues) => {
                    await updateTestimonial(testimonial.id, values);
                  }}
                />

                <RemoveTestimonialConfirm
                  testimonialName={testimonial.name}
                  busy={busy}
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      aria-label="Remove testimonial"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  }
                  onConfirm={() => void deleteTestimonial(testimonial.id)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
