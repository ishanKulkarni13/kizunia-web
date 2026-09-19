import { create } from "zustand";
import { toast } from "sonner";

import { ApiError } from "@/lib/http";

import type { CreateCompetitionSuggestionInput } from "../schemas/create-competition-suggestion";
import type { UpdateCompetitionSuggestionInput } from "../schemas/update-competition-suggestion";
import type { CompetitionSuggestionDTO } from "../types/suggestion";

import { CompetitionSuggestionApi } from "../api/competition-suggestion-api";

interface CompetitionSuggestionStore {
  loading: boolean;

  create(
    data: CreateCompetitionSuggestionInput,
  ): Promise<CompetitionSuggestionDTO>;

  findById(
    id: string,
  ): Promise<CompetitionSuggestionDTO>;

  update(
    id: string,
    data: UpdateCompetitionSuggestionInput,
  ): Promise<CompetitionSuggestionDTO>;

  submit(
    id: string,
  ): Promise<CompetitionSuggestionDTO>;

  reopen(
    id: string,
  ): Promise<CompetitionSuggestionDTO>;

  attachAsset(
    id: string,
    assetId: string,
  ): Promise<CompetitionSuggestionDTO>;

  detachAsset(
    id: string,
    assetId: string,
  ): Promise<CompetitionSuggestionDTO>;
}

export const useCompetitionSuggestionStore =
  create<CompetitionSuggestionStore>((set) => ({
    loading: false,

    // =========================================================================
    // Create
    // =========================================================================

    async create(data) {
      try {
        set({ loading: true });

        return await CompetitionSuggestionApi.create(data);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          toast.error(error.message);
        } else {
          toast.error(
            "Failed to create competition suggestion.",
          );
        }

        throw error;
      } finally {
        set({ loading: false });
      }
    },

    // =========================================================================
    // Read
    // =========================================================================

    async findById(id) {
      try {
        set({ loading: true });

        return await CompetitionSuggestionApi.findById(id);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          toast.error(error.message);
        } else {
          toast.error(
            "Failed to load competition suggestion.",
          );
        }

        throw error;
      } finally {
        set({ loading: false });
      }
    },

    // =========================================================================
    // Update
    // =========================================================================
    //
    // Deliberately does not toggle `loading` — this backs autosave-on-blur
    // for the title/description fields, and flipping the shared loading flag
    // would disable inputs mid-edit for an unrelated save-in-flight.

    async update(id, data) {
      try {
        return await CompetitionSuggestionApi.update(id, data);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          toast.error(error.message);
        } else {
          toast.error(
            "Failed to save competition suggestion.",
          );
        }

        throw error;
      }
    },

    // =========================================================================
    // Submit
    // =========================================================================

    async submit(id) {
      try {
        set({ loading: true });

        return await CompetitionSuggestionApi.submit(id);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          toast.error(error.message);
        } else {
          toast.error(
            "Failed to submit competition suggestion.",
          );
        }

        throw error;
      } finally {
        set({ loading: false });
      }
    },

    // =========================================================================
    // Reopen
    // =========================================================================

    async reopen(id) {
      try {
        set({ loading: true });

        return await CompetitionSuggestionApi.reopen(id);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          toast.error(error.message);
        } else {
          toast.error(
            "Failed to reopen competition suggestion.",
          );
        }

        throw error;
      } finally {
        set({ loading: false });
      }
    },

    // =========================================================================
    // Assets
    // =========================================================================

    async attachAsset(id, assetId) {
      try {
        return await CompetitionSuggestionApi.attachAsset(id, assetId);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          toast.error(error.message);
        } else {
          toast.error("Failed to attach asset.");
        }

        throw error;
      }
    },

    async detachAsset(id, assetId) {
      try {
        return await CompetitionSuggestionApi.detachAsset(id, assetId);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          toast.error(error.message);
        } else {
          toast.error("Failed to remove asset.");
        }

        throw error;
      }
    },
  }));