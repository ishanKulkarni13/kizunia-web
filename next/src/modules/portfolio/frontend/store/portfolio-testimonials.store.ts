import { create } from "zustand";
import { toast } from "sonner";

import { ApiError } from "@/lib/http";

import { PortfolioTestimonialApi } from "../api/portfolio-testimonial-api";
import type { PortfolioTestimonialSummaryDto } from "../../dtos";
import type {
  AddPortfolioTestimonialInput,
  UpdatePortfolioTestimonialInput,
} from "../../schemas/portfolio-testimonial.schema";

interface PortfolioTestimonialsStore {
  testimonials: PortfolioTestimonialSummaryDto[];

  /** Guards `initialize()` from clobbering an in-progress list when the
   * shared portfolio snapshot changes for an unrelated reason. */
  initializedPortfolioId: string | null;

  isLoading: boolean;

  busy: boolean;

  error: string | null;

  initialize: (params: { portfolioId: string }) => Promise<void>;

  createTestimonial: (dto: AddPortfolioTestimonialInput) => Promise<void>;

  updateTestimonial: (
    testimonialId: string,
    dto: UpdatePortfolioTestimonialInput,
  ) => Promise<void>;

  deleteTestimonial: (testimonialId: string) => Promise<void>;

  reorderTestimonials: (testimonialIds: string[]) => Promise<void>;

  reset: () => void;
}

/**
 * Testimonials persist on every action rather than through a batched save
 * flow: each mutation hits its own endpoint immediately, and on success the
 * store is replaced wholesale with the server-returned, authoritative list —
 * never patched locally. Mirrors `usePortfolioProjectsStore`.
 *
 * Pessimistic throughout: every action awaits the server response before
 * touching state.
 */
export const usePortfolioTestimonialsStore = create<PortfolioTestimonialsStore>(
  (set, get) => ({
    testimonials: [],

    initializedPortfolioId: null,

    isLoading: false,

    busy: false,

    error: null,

    initialize: async ({ portfolioId }) => {
      if (get().initializedPortfolioId === portfolioId) {
        return;
      }

      set({ isLoading: true, error: null });

      try {
        const testimonials = await PortfolioTestimonialApi.list();

        set({
          testimonials,
          isLoading: false,
          initializedPortfolioId: portfolioId,
        });
      } catch (error) {
        set({
          isLoading: false,
          error:
            error instanceof ApiError
              ? error.message
              : "Failed to load testimonials.",
        });
      }
    },

    createTestimonial: async (dto) => {
      await run(
        () => PortfolioTestimonialApi.add(dto),
        "Testimonial added.",
      );
    },

    updateTestimonial: async (testimonialId, dto) => {
      await run(
        () => PortfolioTestimonialApi.update(testimonialId, dto),
        "Testimonial updated.",
      );
    },

    deleteTestimonial: async (testimonialId) => {
      await run(
        () => PortfolioTestimonialApi.remove(testimonialId),
        "Testimonial removed.",
      );
    },

    reorderTestimonials: async (testimonialIds) => {
      await run(
        () => PortfolioTestimonialApi.reorder({ testimonialIds }),
        "Testimonials reordered.",
      );
    },

    reset: () => {
      set({
        testimonials: [],
        initializedPortfolioId: null,
        isLoading: false,
        busy: false,
        error: null,
      });
    },
  }),
);

async function run(
  action: () => Promise<PortfolioTestimonialSummaryDto[]>,
  successMessage: string,
): Promise<void> {
  try {
    usePortfolioTestimonialsStore.setState({ busy: true });

    const testimonials = await action();

    usePortfolioTestimonialsStore.setState({ testimonials, busy: false });

    toast.success(successMessage);
  } catch (error) {
    usePortfolioTestimonialsStore.setState({ busy: false });

    if (error instanceof ApiError) {
      toast.error(error.message);
    } else {
      toast.error("Unexpected error");
    }
  }
}
