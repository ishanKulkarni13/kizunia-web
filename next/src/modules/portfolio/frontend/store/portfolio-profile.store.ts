import { create } from "zustand";
import { toast } from "sonner";

import { ApiError } from "@/lib/http";
import { PortfolioApi } from "../api/portfolio-api";
import { UpdatePortfolioProfileDto } from "../../dtos/input/update.dto";
import { PortfolioEditorDto } from "../../dtos";
import { UpdatePortfolioProfileSchema } from "../../schemas/update/profile-update.schema";
import { usePortfolioStore } from "./portfolio.store";

type ProfileFieldErrors = Partial<Record<keyof UpdatePortfolioProfileDto, string>>;

interface PortfolioProfileStore {
  form: UpdatePortfolioProfileDto;

  /** The last-known-saved values, used to compute `isDirty()`. */
  savedForm: UpdatePortfolioProfileDto;

  /** Guards `initialize()` from clobbering an in-progress draft when the
   * shared portfolio snapshot changes for an unrelated reason (e.g. the
   * username was changed). Only re-initializes when the portfolio id
   * itself changes. */
  initializedPortfolioId: string | null;

  isSaving: boolean;

  error: string | null;

  fieldErrors: ProfileFieldErrors;

  initialize: (portfolio: PortfolioEditorDto) => void;

  setField: <K extends keyof UpdatePortfolioProfileDto>(
    field: K,
    value: UpdatePortfolioProfileDto[K],
  ) => void;

  isDirty: () => boolean;

  updateProfile: () => Promise<PortfolioEditorDto | null>;

  reset: () => void;
}

const initialForm: UpdatePortfolioProfileDto = {
  displayName: "",
  headline: null,
  bio: null,
  phone: null,
  publicContactEmail: null,
  location: null,
  resumeAssetId: null,
};

export const usePortfolioProfileStore =
  create<PortfolioProfileStore>((set, get) => ({
    form: initialForm,

    savedForm: initialForm,

    initializedPortfolioId: null,

    isSaving: false,

    error: null,

    fieldErrors: {},

    initialize: (portfolio) => {
      if (get().initializedPortfolioId === portfolio.id) {
        return;
      }

      const form: UpdatePortfolioProfileDto = {
        displayName: portfolio.displayName,
        headline: portfolio.headline,
        bio: portfolio.bio,
        phone: portfolio.phone,
        publicContactEmail: portfolio.publicContactEmail,
        location: portfolio.location,
        resumeAssetId: portfolio.resumeAssetId,
      };

      set({
        form,
        savedForm: form,
        initializedPortfolioId: portfolio.id,
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

    updateProfile: async () => {
      if (get().isSaving) {
        return null;
      }

      const { form } = get();

      const validation = UpdatePortfolioProfileSchema.safeParse(form);

      if (!validation.success) {
        const fieldErrors: ProfileFieldErrors = {};

        for (const issue of validation.error.issues) {
          const key = issue.path[0] as keyof UpdatePortfolioProfileDto | undefined;

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
        const portfolio = await PortfolioApi.updateProfile(form);

        set({
          isSaving: false,
          error: null,
          fieldErrors: {},
          savedForm: form,
        });

        usePortfolioStore.getState().setPortfolio(portfolio);

        toast.success("Profile saved.");

        return portfolio;
      } catch (error) {
        set({
          isSaving: false,
          error:
            error instanceof ApiError
              ? error.message
              : error instanceof Error
                ? error.message
                : "Failed to update profile.",
          fieldErrors: {},
        });

        return null;
      }
    },

    reset: () => {
      set({
        form: initialForm,
        savedForm: initialForm,
        initializedPortfolioId: null,
        isSaving: false,
        error: null,
        fieldErrors: {},
      });
    },
  }));
