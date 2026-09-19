import { create } from "zustand";
import { toast } from "sonner";

import { ApiError } from "@/lib/http";
import { ProjectApi } from "../api/project-api";
import { UpdateProjectContentDto } from "../../backend/dto/input";
import { ProjectDetailsDto } from "../../backend/dto/output";
import { UpdateProjectContentSchema } from "../../backend/dto/input/update-project-content.schema";
import { useProjectStore } from "./project.store";

interface ProjectContentStore {
  content: string;

  /** The last-known-saved content, used to compute `isDirty()`. */
  savedContent: string;

  /** Guards `initialize()` from clobbering an in-progress draft when the
   * shared project snapshot changes for an unrelated reason (e.g. another
   * section saved). Only re-initializes when the project id itself changes. */
  initializedProjectId: string | null;

  isSaving: boolean;
  error: string | null;

  initialize: (project: ProjectDetailsDto) => void;

  setContent: (content: string) => void;

  isDirty: () => boolean;

  updateContent: (params: {
    id: string;
  }) => Promise<ProjectDetailsDto | null>;

  reset: () => void;
}

export const useProjectContentStore =
  create<ProjectContentStore>((set, get) => ({
    content: "",

    savedContent: "",

    initializedProjectId: null,

    isSaving: false,
    error: null,

    initialize: (project) => {
      if (get().initializedProjectId === project.id) {
        return;
      }

      const content = project.content ?? "";

      set({
        content,
        savedContent: content,
        initializedProjectId: project.id,
        error: null,
      });
    },

    setContent: (content) => {
      set({
        content,
        error: null,
      });
    },

    isDirty: () => {
      const { content, savedContent } = get();

      return content !== savedContent;
    },

    updateContent: async ({ id }) => {
      if (get().isSaving) {
        return null;
      }

      const { content } = get();

      const validation = UpdateProjectContentSchema.safeParse({
        content,
      });

      if (!validation.success) {
        set({
          error: validation.error.issues[0]?.message ?? "Invalid content.",
        });

        return null;
      }

      const dto: UpdateProjectContentDto = {
        content,
      };

      set({
        isSaving: true,
        error: null,
      });

      try {
        const project = await ProjectApi.updateContent(
          id,
          dto,
        );

        set({
          isSaving: false,
          error: null,
          savedContent: content,
        });

        useProjectStore.getState().setProject(project);

        toast.success("Content saved.");

        return project;
      } catch (error) {
        set({
          isSaving: false,
          error:
            error instanceof ApiError
              ? error.message
              : error instanceof Error
                ? error.message
                : "Failed to update project content.",
        });

        return null;
      }
    },

    reset: () => {
      set({
        content: "",
        savedContent: "",
        initializedProjectId: null,
        isSaving: false,
        error: null,
      });
    },
  }));
