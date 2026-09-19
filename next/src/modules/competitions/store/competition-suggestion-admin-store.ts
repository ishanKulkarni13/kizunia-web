import { create } from "zustand";
import { toast } from "sonner";

import { ApiError } from "@/lib/http";

import type { CompetitionSuggestionDTO } from "../types/suggestion";
import { CompetitionSuggestionAdminApi } from "../api/competition-suggestion-admin-api";

interface CompetitionSuggestionAdminStore {
  busy: boolean;

  approve(id: string): Promise<CompetitionSuggestionDTO>;

  reject(id: string, reason?: string): Promise<CompetitionSuggestionDTO>;

  requestChanges(
    id: string,
    reason?: string,
  ): Promise<CompetitionSuggestionDTO>;

  detachAsset(
    suggestionId: string,
    assetId: string,
  ): Promise<CompetitionSuggestionDTO>;
}

export const useCompetitionSuggestionAdminStore =
  create<CompetitionSuggestionAdminStore>((set) => ({
    busy: false,

    async approve(id) {
      try {
        set({ busy: true });

        return await CompetitionSuggestionAdminApi.approve(id);
      } catch (error: unknown) {
        toast.error(
          error instanceof ApiError
            ? error.message
            : "Failed to approve this suggestion.",
        );

        throw error;
      } finally {
        set({ busy: false });
      }
    },

    async reject(id, reason) {
      try {
        set({ busy: true });

        return await CompetitionSuggestionAdminApi.reject(id, reason);
      } catch (error: unknown) {
        toast.error(
          error instanceof ApiError
            ? error.message
            : "Failed to reject this suggestion.",
        );

        throw error;
      } finally {
        set({ busy: false });
      }
    },

    async requestChanges(id, reason) {
      try {
        set({ busy: true });

        return await CompetitionSuggestionAdminApi.requestChanges(id, reason);
      } catch (error: unknown) {
        toast.error(
          error instanceof ApiError
            ? error.message
            : "Failed to request changes on this suggestion.",
        );

        throw error;
      } finally {
        set({ busy: false });
      }
    },

    async detachAsset(suggestionId, assetId) {
      try {
        set({ busy: true });

        return await CompetitionSuggestionAdminApi.detachAsset(
          suggestionId,
          assetId,
        );
      } catch (error: unknown) {
        toast.error(
          error instanceof ApiError
            ? error.message
            : "Failed to remove this asset.",
        );

        throw error;
      } finally {
        set({ busy: false });
      }
    },
  }));
