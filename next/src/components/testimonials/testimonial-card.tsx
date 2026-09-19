import { StarIcon } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";

/**
 * Genuinely reusable: purely presentational, and both Project and Portfolio
 * testimonial DTOs already map to this exact shape independently (no shared
 * domain type is imported here — each caller's DTO already satisfies this
 * structurally). See docs/architecture/domain/project.md and portfolio.md.
 */
export interface TestimonialCardData {
  id: string;

  name: string;

  position: string | null;

  company: string | null;

  message: string;

  rating: number | null;

  image: { url: string } | null;
}

interface TestimonialCardProps {
  testimonial: TestimonialCardData;
}

export function TestimonialCard({ testimonial }: TestimonialCardProps) {
  return (
    <Card className="space-y-3 p-5">
      {testimonial.rating !== null && (
        <div className="flex gap-0.5">
          {Array.from({ length: 5 }, (_, index) => (
            <StarIcon
              key={index}
              className={
                index < testimonial.rating!
                  ? "size-4 fill-amber-400 text-amber-400"
                  : "size-4 text-muted-foreground/30"
              }
            />
          ))}
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        &ldquo;{testimonial.message}&rdquo;
      </p>

      <div className="flex items-center gap-3 pt-1">
        <Avatar className="size-8">
          <AvatarImage src={testimonial.image?.url} alt={testimonial.name} />
          <AvatarFallback>{testimonial.name[0]}</AvatarFallback>
        </Avatar>

        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{testimonial.name}</p>

          {(testimonial.position || testimonial.company) && (
            <p className="truncate text-xs text-muted-foreground">
              {[testimonial.position, testimonial.company]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

interface TestimonialCardGridProps {
  testimonials: TestimonialCardData[];
}

/**
 * Renders in list order — callers are responsible for server/DB-side
 * ordering (`displayOrder asc`); this component performs no re-sorting.
 */
export function TestimonialCardGrid({ testimonials }: TestimonialCardGridProps) {
  if (testimonials.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {testimonials.map((testimonial) => (
        <TestimonialCard key={testimonial.id} testimonial={testimonial} />
      ))}
    </div>
  );
}
