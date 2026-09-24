import { create } from "zustand";
import { toast } from "sonner";

import { AuthorizationCode } from "@/authorization";
import { ApiError } from "@/lib/http";
import { registerSessionReset } from "@/lib/session/reset-registry";

import { PortfolioApi } from "../api/portfolio-api";
import { PortfolioEditorDto } from "../../dtos";
import { PortfolioErrorCode } from "../../errors/error-code";

interface PortfolioStore {
  portfolio: PortfolioEditorDto | null;

  /**
   * The user's portfolio exists but is soft-deleted. Mutually exclusive with
   * `portfolio` being set: the server refuses to hand a deleted portfolio to
   * the editor, and creating a replacement is refused too, so the only way
   * forward is `restorePortfolio`.
   */
  isDeleted: boolean;

  isLoading: boolean;
  isCreating: boolean;

  /** A visibility change, delete or restore is in flight. */
  isMutating: boolean;

  error: string | null;

  getMine: () => Promise<void>;
  createPortfolio: () => Promise<PortfolioEditorDto | null>;

  setVisibility: (visibility: PortfolioEditorDto["visibility"]) => Promise<void>;
  deletePortfolio: () => Promise<boolean>;
  restorePortfolio: () => Promise<void>;

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

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export const usePortfolioStore = create<PortfolioStore>((set, get) => ({
  portfolio: null,

  isDeleted: false,

  isLoading: false,
  isCreating: false,
  isMutating: false,

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
        isDeleted: false,
        isLoading: false,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        set({
          portfolio: null,
          isDeleted: false,
          isLoading: false,
          error: null,
        });

        return;
      }

      // Not an error to show: the owner has a portfolio, it is just deleted,
      // and the page offers to restore it.
      if (
        error instanceof ApiError &&
        error.code === AuthorizationCode.RESOURCE_DELETED
      ) {
        set({
          portfolio: null,
          isDeleted: true,
          isLoading: false,
          error: null,
        });

        return;
      }

      set({
        isLoading: false,
        error: errorMessage(error, "Failed to load portfolio."),
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
        isDeleted: false,
        isCreating: false,
      });

      return portfolio;
    } catch (error) {
      // A deleted portfolio still occupies the user's one slot: surface the
      // restore path instead of a dead-end error.
      if (
        error instanceof ApiError &&
        error.code === PortfolioErrorCode.DELETED
      ) {
        set({
          portfolio: null,
          isDeleted: true,
          isCreating: false,
        });

        return null;
      }

      set({
        isCreating: false,
        error: errorMessage(error, "Failed to create portfolio."),
      });

      return null;
    }
  },

  setVisibility: async (visibility) => {
    if (get().isMutating) {
      return;
    }

    set({ isMutating: true });

    try {
      const portfolio = await PortfolioApi.setVisibility({ visibility });

      set({ portfolio, isMutating: false });

      toast.success(
        visibility === "PUBLIC"
          ? "Your portfolio is now public."
          : "Your portfolio is now private.",
      );
    } catch (error) {
      set({ isMutating: false });

      toast.error(errorMessage(error, "Failed to change visibility."));
    }
  },

  deletePortfolio: async () => {
    if (get().isMutating) {
      return false;
    }

    set({ isMutating: true });

    try {
      await PortfolioApi.delete();

      set({
        portfolio: null,
        isDeleted: true,
        isMutating: false,
      });

      return true;
    } catch (error) {
      set({ isMutating: false });

      toast.error(errorMessage(error, "Failed to delete portfolio."));

      return false;
    }
  },

  restorePortfolio: async () => {
    if (get().isMutating) {
      return;
    }

    set({ isMutating: true });

    try {
      const portfolio = await PortfolioApi.restore();

      set({
        portfolio,
        isDeleted: false,
        isMutating: false,
      });

      toast.success("Portfolio restored. It is private until you publish it.");
    } catch (error) {
      set({ isMutating: false });

      toast.error(errorMessage(error, "Failed to restore portfolio."));
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
      isDeleted: false,
      isLoading: false,
      isCreating: false,
      isMutating: false,
      error: null,
    });
  },
}));

// Holds the signed-in account's data: cleared when the account changes so
// it can never be shown, or saved, as another account's.
registerSessionReset(() => usePortfolioStore.getState().clear());
