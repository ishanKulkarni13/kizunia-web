import { create } from "zustand";
import { toast } from "sonner";

import { ApiError } from "@/lib/http";

import { PortfolioProjectApi } from "../api/portfolio-project-api";
import type { PortfolioProjectSummaryDto } from "../../dtos";
import type {
  AddPortfolioProjectInput,
  UpdatePortfolioProjectInput,
} from "../../schemas/portfolio-project.schema";

interface PortfolioProjectsStore {
  projects: PortfolioProjectSummaryDto[];

  /** Guards `initialize()` from clobbering an in-progress list when the
   * shared portfolio snapshot changes for an unrelated reason. */
  initializedPortfolioId: string | null;

  isLoading: boolean;

  busy: boolean;

  error: string | null;

  initialize: (params: { portfolioId: string }) => Promise<void>;

  addProject: (dto: AddPortfolioProjectInput) => Promise<void>;

  removeProject: (projectId: string) => Promise<void>;

  setFeatured: (
    projectId: string,
    dto: UpdatePortfolioProjectInput,
  ) => Promise<void>;

  reorderProjects: (projectIds: string[]) => Promise<void>;

  reset: () => void;
}

/**
 * Projects persist on every action rather than through a batched save flow:
 * each mutation hits its own endpoint immediately, and on success the store
 * is replaced wholesale with the server-returned, authoritative list — never
 * patched locally. Mirrors `useProjectLinksStore`.
 *
 * Pessimistic throughout: every action awaits the server response before
 * touching state. There is no optimistic add/remove/reorder — if a mutation
 * fails, the list simply stays at its last server-confirmed value.
 */
export const usePortfolioProjectsStore = create<PortfolioProjectsStore>(
  (set, get) => ({
    projects: [],

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
        const projects = await PortfolioProjectApi.list();

        set({
          projects,
          isLoading: false,
          initializedPortfolioId: portfolioId,
        });
      } catch (error) {
        set({
          isLoading: false,
          error:
            error instanceof ApiError
              ? error.message
              : "Failed to load projects.",
        });
      }
    },

    addProject: async (dto) => {
      await run(() => PortfolioProjectApi.add(dto), "Project added.");
    },

    removeProject: async (projectId) => {
      await run(
        () => PortfolioProjectApi.remove(projectId),
        "Project removed from your portfolio.",
      );
    },

    setFeatured: async (projectId, dto) => {
      await run(
        () => PortfolioProjectApi.setFeatured(projectId, dto),
        dto.featured ? "Project featured." : "Project unfeatured.",
      );
    },

    reorderProjects: async (projectIds) => {
      await run(
        () => PortfolioProjectApi.reorder({ projectIds }),
        "Projects reordered.",
      );
    },

    reset: () => {
      set({
        projects: [],
        initializedPortfolioId: null,
        isLoading: false,
        busy: false,
        error: null,
      });
    },
  }),
);

async function run(
  action: () => Promise<PortfolioProjectSummaryDto[]>,
  successMessage: string,
): Promise<void> {
  try {
    usePortfolioProjectsStore.setState({ busy: true });

    const projects = await action();

    usePortfolioProjectsStore.setState({ projects, busy: false });

    toast.success(successMessage);
  } catch (error) {
    usePortfolioProjectsStore.setState({ busy: false });

    if (error instanceof ApiError) {
      toast.error(error.message);
    } else {
      toast.error("Unexpected error");
    }
  }
}
