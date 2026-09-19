import { create } from "zustand";
import { toast } from "sonner";

import { ApiError } from "@/lib/http";

import { PortfolioTechnologyApi } from "../api/portfolio-technology-api";
import type { PortfolioTechnologySummaryDto } from "../../dtos";
import type {
  AddPortfolioTechnologyInput,
  UpdatePortfolioTechnologyInput,
} from "../../schemas/portfolio-technology.schema";

interface PortfolioTechnologiesStore {
  technologies: PortfolioTechnologySummaryDto[];

  /** Guards `initialize()` from clobbering an in-progress list when the
   * shared portfolio snapshot changes for an unrelated reason. */
  initializedPortfolioId: string | null;

  isLoading: boolean;

  busy: boolean;

  error: string | null;

  initialize: (params: { portfolioId: string }) => Promise<void>;

  addTechnology: (dto: AddPortfolioTechnologyInput) => Promise<void>;

  updateTechnology: (
    technologyId: string,
    dto: UpdatePortfolioTechnologyInput,
  ) => Promise<void>;

  removeTechnology: (technologyId: string) => Promise<void>;

  reorderTechnologies: (technologyIds: string[]) => Promise<void>;

  reset: () => void;
}

/**
 * Technologies persist on every action rather than through a batched save
 * flow: each mutation hits its own endpoint immediately, and on success the
 * store is replaced wholesale with the server-returned, authoritative list —
 * never patched locally. Mirrors `usePortfolioProjectsStore`.
 *
 * Pessimistic throughout: every action awaits the server response before
 * touching state. There is no optimistic add/update/remove/reorder — if a
 * mutation fails, the list simply stays at its last server-confirmed value.
 */
export const usePortfolioTechnologiesStore = create<PortfolioTechnologiesStore>(
  (set, get) => ({
    technologies: [],

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
        const technologies = await PortfolioTechnologyApi.list();

        set({
          technologies,
          isLoading: false,
          initializedPortfolioId: portfolioId,
        });
      } catch (error) {
        set({
          isLoading: false,
          error:
            error instanceof ApiError
              ? error.message
              : "Failed to load technologies.",
        });
      }
    },

    addTechnology: async (dto) => {
      await run(
        () => PortfolioTechnologyApi.add(dto),
        "Technology added.",
      );
    },

    updateTechnology: async (technologyId, dto) => {
      await run(
        () => PortfolioTechnologyApi.update(technologyId, dto),
        "Technology updated.",
      );
    },

    removeTechnology: async (technologyId) => {
      await run(
        () => PortfolioTechnologyApi.remove(technologyId),
        "Technology removed from your portfolio.",
      );
    },

    reorderTechnologies: async (technologyIds) => {
      await run(
        () => PortfolioTechnologyApi.reorder({ technologyIds }),
        "Technologies reordered.",
      );
    },

    reset: () => {
      set({
        technologies: [],
        initializedPortfolioId: null,
        isLoading: false,
        busy: false,
        error: null,
      });
    },
  }),
);

async function run(
  action: () => Promise<PortfolioTechnologySummaryDto[]>,
  successMessage: string,
): Promise<void> {
  try {
    usePortfolioTechnologiesStore.setState({ busy: true });

    const technologies = await action();

    usePortfolioTechnologiesStore.setState({ technologies, busy: false });

    toast.success(successMessage);
  } catch (error) {
    usePortfolioTechnologiesStore.setState({ busy: false });

    if (error instanceof ApiError) {
      toast.error(error.message);
    } else {
      toast.error("Unexpected error");
    }
  }
}
