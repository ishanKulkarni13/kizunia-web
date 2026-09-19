import { create } from "zustand";

import { ApiError } from "@/lib/http";
import { PortfolioApi } from "../api/portfolio-api";
import { PortfolioEditorDto } from "../../dtos";

interface PortfolioStore {
  portfolio: PortfolioEditorDto | null;

  isLoading: boolean;
  isCreating: boolean;

  error: string | null;

  getMine: () => Promise<void>;
  createPortfolio: () => Promise<PortfolioEditorDto | null>;

  /**
   * Replaces the snapshot in place with a resource already returned by a
   * mutation (e.g. a section's updateProfile), without a network round
   * trip. Section editor stores should call this after a successful save
   * so shared chrome (header, nav, other sections' read-only data) reflects
   * the change immediately.
   */
  setPortfolio: (portfolio: PortfolioEditorDto) => void;

  clear: () => void;
}

export const usePortfolioStore = create<PortfolioStore>((set) => ({
  portfolio: null,

  isLoading: false,
  isCreating: false,

  error: null,

  getMine: async () => {
    set({
      isLoading: true,
      error: null,
    });

    try {
      const portfolio = await PortfolioApi.getMine();

      set({
        portfolio,
        isLoading: false,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        set({
          portfolio: null,
          isLoading: false,
          error: null,
        });

        return;
      }

      set({
        isLoading: false,
        error:
          error instanceof Error ? error.message : "Failed to load portfolio.",
      });
    }
  },

  createPortfolio: async () => {
    set({
      isCreating: true,
      error: null,
    });

    try {
      const portfolio = await PortfolioApi.create();

      set({
        portfolio,
        isCreating: false,
      });

      return portfolio;
    } catch (error) {
      set({
        isCreating: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to create portfolio.",
      });

      return null;
    }
  },

  setPortfolio: (portfolio) => {
    set({
      portfolio,
      error: null,
    });
  },

  clear: () => {
    set({
      portfolio: null,
      isLoading: false,
      isCreating: false,
      error: null,
    });
  },
}));
