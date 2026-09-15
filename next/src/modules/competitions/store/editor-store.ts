import { create } from "zustand";
import { toast } from "sonner";
import type { CompetitionEditDTOWithPermissions } from "../types/edit-dto";
import type { CompetitionLocationDTO } from "../types/competition-location.dto";
import type { CompetitionTechnologyDTO } from "../types/competition-technology.dto";
import type { CompetitionEligibilityDTO } from "../types/competition-eligibility.dto";
import { CompetitionApi } from "../api/competition-api";
import { UpdateCompetitionSchema } from "../schemas/update-competition";
import { CompetitionErrorCode } from "../errors/error-code";
import {
  buildUpdateCompetitionPayload,
  type EditableScalarKey,
} from "../editor/build-update-payload";
import { normalizeEditorPatch } from "../editor/normalize";
import { slugify } from "@/utils/utils";
import { ApiError } from "@/lib/http";

type FieldErrors = Partial<Record<EditableScalarKey, string>>;

type AssetSlot = "logo" | "banner" | "cover";

interface CompetitionEditorStore {
  competition: CompetitionEditDTOWithPermissions | null;

  /** The last-known-persisted snapshot. Every derived value in this store
   * (dirty state, field status, the diff payload) is computed by comparing
   * `competition` to this, rather than tracked as separate flags. */
  original: CompetitionEditDTOWithPermissions | null;

  saving: boolean;

  deleting: boolean;

  /** When the last successful save completed, for a "Saved just now" style
   * display. Reset to null by `initialize`/`reset`. */
  lastSavedAt: Date | null;

  /** Per-field validation messages — populated from a client-side pre-parse
   * before sending and from the server's 422 response after. Deliberately
   * separate from field status (NULL/UNSAVED/DONE): a field can be
   * `UNSAVED` and carry an error at the same time; neither implies the
   * other. */
  fieldErrors: FieldErrors;

  initialize: (competition: CompetitionEditDTOWithPermissions) => void;

  /**
   * Merges a partial edit into the current draft. Runs
   * `normalizeEditorPatch` first, so empty/whitespace-only input in a
   * nullable text field becomes `null` before it ever reaches `competition`
   * — every other reader (dirty state, field status, the save payload)
   * then sees only canonical values. Also clears any existing validation
   * error on a touched field, since the admin is actively correcting it.
   */
  updateCompetition(partial: Partial<CompetitionEditDTOWithPermissions>): void;

  /** Replaces the slug with one generated from the current title. An
   * explicit action, never automatic on an existing competition — see
   * `editor/normalize.ts`'s module doc and the plan's slug architecture
   * section for why title changes must not silently move an existing
   * slug. */
  regenerateSlug(): void;

  /**
   * Replaces the location list after a locations endpoint has already
   * persisted it.
   *
   * Writes to both `competition` and `original`: locations save through
   * their own endpoints, so treating them as a pending diff would strand
   * the save button and let Reset silently undo work that is already
   * committed on the server.
   */
  setLocations(locations: CompetitionLocationDTO[]): void;

  /**
   * Replaces the technology list after a technologies endpoint has already
   * persisted it. Same reasoning as `setLocations`.
   */
  setTechnologies(technologies: CompetitionTechnologyDTO[]): void;

  /**
   * Replaces the eligibility list after an eligibilities endpoint has
   * already persisted it. Same reasoning as `setLocations`/`setTechnologies`.
   */
  setEligibilities(eligibilities: CompetitionEligibilityDTO[]): void;

  /**
   * Merges a freshly-persisted asset slot (logo/banner/cover) into both
   * `competition` and `original` — same "already persisted, not a pending
   * diff" reasoning as `setLocations`/`setTechnologies`. Replaces the old
   * `setCompetition(updated)` call, which reset the *entire* draft to the
   * server's response and silently discarded any unsaved field edits.
   */
  applyPersistedAsset(
    slot: AssetSlot,
    response: CompetitionEditDTOWithPermissions,
  ): void;

  /** True when the current draft differs from the last-persisted snapshot
   * in any field the PATCH payload would carry. Derived from
   * `buildUpdateCompetitionPayload`, not tracked as a separate flag — a
   * value typed and then reverted to its saved state resolves back to
   * `false` without any extra bookkeeping. */
  isDirty: () => boolean;

  save: () => Promise<void>;

  deleteCompetition: () => Promise<boolean>;

  reset(): void;
}

function buildFieldErrorsFromDetails(
  details: unknown,
): FieldErrors {
  const fields = (details as { fields?: Record<string, string> } | undefined)
    ?.fields;

  if (!fields) return {};

  return fields as FieldErrors;
}

export const useCompetitionEditorStore = create<CompetitionEditorStore>(
  (set, get) => ({
    competition: null,
    saving: false,
    deleting: false,
    original: null,
    lastSavedAt: null,
    fieldErrors: {},

    initialize: (competition) =>
      set({
        competition,
        original: structuredClone(competition),
        lastSavedAt: null,
        fieldErrors: {},
      }),

    updateCompetition: (partial) =>
      set((state) => {
        if (!state.competition) {
          return state;
        }

        const normalized = normalizeEditorPatch(partial);

        const fieldErrors = { ...state.fieldErrors };
        for (const key of Object.keys(normalized)) {
          delete fieldErrors[key as EditableScalarKey];
        }

        return {
          competition: {
            ...state.competition,
            ...normalized,
          },
          fieldErrors,
        };
      }),

    regenerateSlug: () =>
      set((state) => {
        if (!state.competition) return state;

        return {
          competition: {
            ...state.competition,
            slug: slugify(state.competition.title),
          },
          fieldErrors: { ...state.fieldErrors, slug: undefined },
        };
      }),

    setLocations: (locations) =>
      set((state) => {
        if (!state.competition) {
          return state;
        }

        return {
          competition: {
            ...state.competition,
            locations,
          },

          original: state.original
            ? {
                ...state.original,
                locations,
              }
            : state.original,
        };
      }),

    setTechnologies: (technologies) =>
      set((state) => {
        if (!state.competition) {
          return state;
        }

        return {
          competition: {
            ...state.competition,
            technologies,
          },

          original: state.original
            ? {
                ...state.original,
                technologies,
              }
            : state.original,
        };
      }),

    setEligibilities: (eligibilities) =>
      set((state) => {
        if (!state.competition) {
          return state;
        }

        return {
          competition: {
            ...state.competition,
            eligibilities,
          },

          original: state.original
            ? {
                ...state.original,
                eligibilities,
              }
            : state.original,
        };
      }),

    applyPersistedAsset: (slot, response) =>
      set((state) => {
        if (!state.competition || !state.original) {
          return state;
        }

        const key = `${slot}Asset` as
          | "logoAsset"
          | "bannerAsset"
          | "coverAsset";

        const value = response[key];

        return {
          competition: { ...state.competition, [key]: value },
          original: { ...state.original, [key]: value },
        };
      }),

    isDirty: () => {
      const { competition, original } = get();
      if (!competition || !original) return false;
      const payload = buildUpdateCompetitionPayload(competition, original);
      return Object.keys(payload).length > 0;
    },

    save: async () => {
      const state = get();

      if (!state.competition || !state.original) {
        return;
      }

      if (state.saving) {
        return;
      }

      const payload = buildUpdateCompetitionPayload(
        state.competition,
        state.original,
      );

      // No-op: nothing changed. `UpdateCompetitionSchema` rejects an empty
      // body outright, so this guard also prevents a guaranteed 422.
      if (Object.keys(payload).length === 0) {
        return;
      }

      const clientValidation = UpdateCompetitionSchema.safeParse(payload);

      if (!clientValidation.success) {
        const fieldErrors: FieldErrors = {};

        for (const issue of clientValidation.error.issues) {
          const key = issue.path[0] as EditableScalarKey | undefined;
          if (key && !fieldErrors[key]) {
            fieldErrors[key] = issue.message;
          }
        }

        set({ fieldErrors });
        toast.error("Please fix the highlighted fields before saving.");
        return;
      }

      set({ saving: true });

      try {
        const updated = await CompetitionApi.update(
          state.competition.id,
          payload,
        );

        // Adopt the server's response rather than the pre-save local
        // snapshot: the backend may have just recalculated `status` (a
        // lifecycle date changed, or automation was re-enabled), and this
        // is how that result reaches the UI immediately, without a page
        // refresh. Reading the store's state again here (rather than
        // reusing the `state` captured at the top of this function) also
        // means edits made while the request was in flight are not
        // silently discarded and marked clean.
        const latest = get();
        set({
          competition: latest.competition
            ? { ...latest.competition, ...updated }
            : updated,
          original: structuredClone(updated),
          saving: false,
          lastSavedAt: new Date(),
          fieldErrors: {},
        });

        toast.success("Competition updated successfully.");
      } catch (error) {
        set({ saving: false });

        if (error instanceof ApiError) {
          if (error.code === CompetitionErrorCode.DUPLICATE_SLUG) {
            set({ fieldErrors: { slug: error.message } });
            toast.error(error.message);
            return;
          }

          if (error.code === "VALIDATION_FAILED") {
            const fieldErrors = buildFieldErrorsFromDetails(error.details);
            set({ fieldErrors });
            toast.error("Validation failed. Please check your input.", {
              description:
                Object.values(fieldErrors)[0] ??
                "One or more fields could not be saved.",
            });
            return;
          }

          toast.error(error.message);
          return;
        }

        toast.error("Unexpected error while saving.");
      }
    },

    deleteCompetition: async () => {
      const state = get();

      if (!state.competition) {
        return false;
      }

      set({ deleting: true });

      try {
        await CompetitionApi.delete(state.competition.id);

        set({ deleting: false });

        toast.success("Competition deleted.");

        return true;
      } catch (error) {
        set({ deleting: false });

        if (error instanceof ApiError) {
          toast.error(error.message);
          return false;
        }

        toast.error("Unexpected error while deleting.");
        return false;
      }
    },

    reset: () =>
      set((state) => ({
        competition: state.original ? structuredClone(state.original) : null,
        fieldErrors: {},
      })),
  }),
);
