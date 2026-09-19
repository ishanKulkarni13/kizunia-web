import { create } from "zustand";
import { toast } from "sonner";

import { ApiError } from "@/lib/http";
import { ProjectApi } from "../api/project-api";
import { ProjectDetailsDto } from "../../backend/dto/output";

interface ProjectStore {
  project: ProjectDetailsDto | null;

  isLoading: boolean;

  error: string | null;

  isDeleting: boolean;

  getProject: (params: {
    id: string;
  }) => Promise<void>;

  /**
   * Replaces the snapshot in place with a resource already returned by a
   * mutation (e.g. updateProfile/updateContent), without a network round
   * trip. Section editor stores should call this after a successful save
   * so shared chrome (header, nav, other sections' read-only data) reflects
   * the change immediately.
   */
  setProject: (project: ProjectDetailsDto) => void;

  /**
   * Soft-deletes the project via the existing DELETE endpoint. Returns
   * whether the deletion succeeded so the caller can decide navigation;
   * the store itself owns the success/error toast so callers must not
   * show their own.
   */
  deleteProject: (id: string) => Promise<boolean>;

  clear: () => void;
}

export const useProjectStore = create<ProjectStore>(
  (set, get) => ({
    project: null,

    isLoading: true,

    error: null,

    isDeleting: false,

    getProject: async ({ id }) => {
      set({
        isLoading: true,
        error: null,
      });

      try {
        const project = await ProjectApi.getById(id);

        set({
          project,
          isLoading: false,
          error: null,
        });
      } catch (error) {
        set({
          project: null,
          isLoading: false,
          error:
            error instanceof ApiError
              ? error.message
              : error instanceof Error
                ? error.message
                : "Failed to load project.",
        });
      }
    },

    setProject: (project) => {
      set({
        project,
        error: null,
      });
    },

    deleteProject: async (id) => {
      if (get().isDeleting) {
        return false;
      }

      set({ isDeleting: true });

      try {
        await ProjectApi.delete(id);

        toast.success("Project deleted.");

        set({
          project: null,
          isLoading: false,
          error: null,
          isDeleting: false,
        });

        return true;
      } catch (error) {
        set({ isDeleting: false });

        toast.error(
          error instanceof ApiError
            ? error.message
            : "Failed to delete project.",
        );

        return false;
      }
    },

    clear: () => {
      set({
        project: null,
        isLoading: false,
        error: null,
        isDeleting: false,
      });
    },
  }),
);