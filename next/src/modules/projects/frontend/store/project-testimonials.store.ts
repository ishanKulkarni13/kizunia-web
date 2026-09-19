import { create } from "zustand";
import { toast } from "sonner";

import { ApiError } from "@/lib/http";
import { ProjectTestimonialApi } from "../api/project-testimonial-api";
import type { ProjectTestimonialDto } from "../../backend/dto/output";
import type {
  CreateProjectTestimonialInput,
  UpdateProjectTestimonialInput,
} from "../../schemas/project-testimonial.schema";

interface ProjectTestimonialsStore {
  testimonials: ProjectTestimonialDto[];

  /** Guards `initialize()` from clobbering an in-progress list when the
   * shared project snapshot changes for an unrelated reason. */
  initializedProjectId: string | null;

  busy: boolean;

  initialize: (params: {
    projectId: string;
    testimonials: ProjectTestimonialDto[];
  }) => void;

  createTestimonial: (params: {
    projectId: string;
    dto: CreateProjectTestimonialInput;
  }) => Promise<void>;

  updateTestimonial: (params: {
    projectId: string;
    testimonialId: string;
    dto: UpdateProjectTestimonialInput;
  }) => Promise<void>;

  deleteTestimonial: (params: {
    projectId: string;
    testimonialId: string;
  }) => Promise<void>;

  reorderTestimonials: (params: {
    projectId: string;
    ids: string[];
  }) => Promise<void>;
}

/**
 * Testimonials persist on every action rather than through a batched save
 * flow: each mutation hits its own endpoint immediately, and on success the
 * store is replaced wholesale with the server-returned, authoritative
 * ordering — never patched locally. Mirrors Project Links.
 */
export const useProjectTestimonialsStore = create<ProjectTestimonialsStore>(
  (set, get) => ({
    testimonials: [],

    initializedProjectId: null,

    busy: false,

    initialize: ({ projectId, testimonials }) => {
      if (get().initializedProjectId === projectId) {
        return;
      }

      set({
        testimonials,
        initializedProjectId: projectId,
      });
    },

    createTestimonial: async ({ projectId, dto }) => {
      await run(
        () => ProjectTestimonialApi.create(projectId, dto),
        "Testimonial added.",
      );
    },

    updateTestimonial: async ({ projectId, testimonialId, dto }) => {
      await run(
        () => ProjectTestimonialApi.update(projectId, testimonialId, dto),
        "Testimonial updated.",
      );
    },

    deleteTestimonial: async ({ projectId, testimonialId }) => {
      await run(
        () => ProjectTestimonialApi.delete(projectId, testimonialId),
        "Testimonial removed.",
      );
    },

    reorderTestimonials: async ({ projectId, ids }) => {
      await run(
        () => ProjectTestimonialApi.reorder(projectId, { ids }),
        "Testimonials reordered.",
      );
    },
  }),
);

async function run(
  action: () => Promise<ProjectTestimonialDto[]>,
  successMessage: string,
): Promise<void> {
  try {
    useProjectTestimonialsStore.setState({ busy: true });

    const testimonials = await action();

    useProjectTestimonialsStore.setState({ testimonials, busy: false });

    toast.success(successMessage);
  } catch (error) {
    useProjectTestimonialsStore.setState({ busy: false });

    if (error instanceof ApiError) {
      toast.error(error.message);
    } else {
      toast.error("Unexpected error");
    }
  }
}
