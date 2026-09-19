import { create } from "zustand";
import { toast } from "sonner";

import { ApiError } from "@/lib/http";
import { ProjectApi } from "../api/project-api";
import { UpdateProjectProfileDto } from "../../backend/dto/input";
import { ProjectDetailsDto } from "../../backend/dto/output";
import { ProjectErrorCode } from "../../backend/errors/error-code";
import { UpdateProjectProfileSchema } from "../../schemas/update-project-profile.schema";
import { useProjectStore } from "./project.store";

type ProfileFieldErrors = Partial<Record<keyof UpdateProjectProfileDto, string>>;

interface ProjectProfileStore {
  form: UpdateProjectProfileDto;

  /** The last-known-saved values, used to compute `isDirty()`. */
  savedForm: UpdateProjectProfileDto;

  /** Guards `initialize()` from clobbering an in-progress draft when the
   * shared project snapshot changes for an unrelated reason (e.g. another
   * section saved). Only re-initializes when the project id itself changes. */
  initializedProjectId: string | null;

  isSaving: boolean;

  error: string | null;

  fieldErrors: ProfileFieldErrors;

  initialize: (project: ProjectDetailsDto) => void;

  setField: <K extends keyof UpdateProjectProfileDto>(
    field: K,
    value: UpdateProjectProfileDto[K],
  ) => void;

  isDirty: () => boolean;

  updateProfile: (params: {
    id: string;
  }) => Promise<ProjectDetailsDto | null>;

  reset: () => void;
}

const initialForm: UpdateProjectProfileDto = {
  title: "",
  slug: "",
  shortDescription: "",
  status: "DRAFT",
  visibility: "PUBLIC",
};

export const useProjectProfileStore =
  create<ProjectProfileStore>((set, get) => ({
    form: initialForm,

    savedForm: initialForm,

    initializedProjectId: null,

    isSaving: false,

    error: null,

    fieldErrors: {},

    initialize: (project) => {
      if (get().initializedProjectId === project.id) {
        return;
      }

      const form: UpdateProjectProfileDto = {
        title: project.title,
        slug: project.slug,
        shortDescription: project.shortDescription,
        status: project.status,
        visibility: project.visibility,
      };

      set({
        form,
        savedForm: form,
        initializedProjectId: project.id,
        error: null,
        fieldErrors: {},
      });
    },

    setField: (field, value) => {
      set((state) => ({
        form: {
          ...state.form,
          [field]: value,
        },
        error: null,
        fieldErrors: {
          ...state.fieldErrors,
          [field]: undefined,
        },
      }));
    },

    isDirty: () => {
      const { form, savedForm } = get();

      return JSON.stringify(form) !== JSON.stringify(savedForm);
    },

    updateProfile: async ({ id }) => {
      if (get().isSaving) {
        return null;
      }

      const { form } = get();

      const validation = UpdateProjectProfileSchema.safeParse(form);

      if (!validation.success) {
        const fieldErrors: ProfileFieldErrors = {};

        for (const issue of validation.error.issues) {
          const key = issue.path[0] as keyof UpdateProjectProfileDto | undefined;

          if (key && !fieldErrors[key]) {
            fieldErrors[key] = issue.message;
          }
        }

        set({
          error: "Please fix the errors below.",
          fieldErrors,
        });

        return null;
      }

      set({
        isSaving: true,
        error: null,
        fieldErrors: {},
      });

      try {
        const project = await ProjectApi.updateProfile(
          id,
          form,
        );

        set({
          isSaving: false,
          error: null,
          fieldErrors: {},
          savedForm: form,
        });

        useProjectStore.getState().setProject(project);

        toast.success("Profile saved.");

        return project;
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.code === ProjectErrorCode.DUPLICATE_SLUG
        ) {
          set({
            isSaving: false,
            error: null,
            fieldErrors: {
              slug: error.message,
            },
          });

          return null;
        }

        set({
          isSaving: false,
          error:
            error instanceof ApiError
              ? error.message
              : error instanceof Error
                ? error.message
                : "Failed to update project.",
          fieldErrors: {},
        });

        return null;
      }
    },

    reset: () => {
      set({
        form: initialForm,
        savedForm: initialForm,
        initializedProjectId: null,
        isSaving: false,
        error: null,
        fieldErrors: {},
      });
    },
  }));
