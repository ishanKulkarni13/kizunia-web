"use client";

/**
 * Search Core (React) - Presets, bound to the URL
 *
 * =============================================================================
 * A binding, not a second state machine
 * =============================================================================
 *
 * Every rule about what a preset does to a search lives in `../presets` as a
 * pure function over parameters. This hook's whole job is to hold the saved
 * list, resolve what is active, and hand each of those functions to the one
 * navigation seam the rest of the search already uses.
 *
 * Keeping it that thin is what makes the behaviour testable without a browser,
 * and what stops a preset from becoming a parallel source of truth: there is
 * no preset state here that the URL does not already describe.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";

import type { ParamPatch } from "../params";
import type { FilterSpec } from "../spec";
import type { RawSearchParams } from "../types";
import {
  activatePresetPatch,
  applyPresetPatch,
  capturePresetFilters,
  deactivatePresetPatch,
  resolveActivePreset,
  visiblePlatformPresets,
  type ActivePreset,
  type CustomPreset,
  type PlatformPreset,
} from "../presets";
import type { CustomPresetStore } from "../preset-storage";
import type { ApplySearchOptions } from "./use-search-params-state";

export interface UseSearchPresetsOptions {
  /** Every registered filter — what a preset clears, and what it may set. */
  readonly specs: readonly FilterSpec[];

  /**
   * The parameters a preset should be judged and captured against.
   *
   * On a staged surface this is the applied search *with* the pending edits
   * already laid over it, so "save these filters" saves what the person can
   * see rather than what the URL happens to say while a panel is open.
   */
  readonly params: RawSearchParams;

  readonly apply: (patch: ParamPatch, options?: ApplySearchOptions) => void;

  readonly platformPresets: readonly PlatformPreset[];

  readonly store: CustomPresetStore;

  /**
   * The staged edits `params` already reflects, if this is a staged surface.
   *
   * Saving commits them in the same navigation that marks the new preset
   * active. Without that, someone who ticked two filters and pressed "Save
   * these filters as a preset" would get a preset holding the right filters
   * and a page still showing the old results — and would have to find the
   * Apply button to reconcile the two. Asking them to press Apply first, then
   * reopen the panel to save, is the same problem with extra steps.
   */
  readonly pendingPatch?: ParamPatch;
}

export interface SearchPresetsState {
  /** Enabled platform presets, in display order. */
  readonly platformPresets: readonly PlatformPreset[];

  readonly customPresets: readonly CustomPreset[];

  readonly active: ActivePreset;

  /** Whether the current search contains anything worth saving. */
  readonly canSaveCurrentSearch: boolean;

  readonly applyPlatformPreset: (preset: PlatformPreset) => void;

  readonly applyCustomPreset: (preset: CustomPreset) => void;

  /** Returns the saved preset, or `undefined` when storage refused it. */
  readonly saveCurrentSearch: (name: string) => CustomPreset | undefined;

  readonly renameCustomPreset: (id: string, name: string) => boolean;

  readonly deleteCustomPreset: (id: string) => boolean;
}

export function useSearchPresets({
  specs,
  params,
  apply,
  platformPresets,
  store,
  pendingPatch,
}: UseSearchPresetsOptions): SearchPresetsState {
  // The saved list is browser state, not React state, and is read through the
  // store's own snapshot so a change made in another tab reaches this one.
  // During server rendering and hydration the server snapshot — an empty list
  // — is used, which is the truth: the server cannot see this browser's
  // storage, and pretending otherwise is what produces a hydration mismatch.
  const customPresets = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  const enabledPlatformPresets = useMemo(
    () => visiblePlatformPresets(platformPresets),
    [platformPresets],
  );

  const active = useMemo(
    () =>
      resolveActivePreset(params, {
        platformPresets: enabledPlatformPresets,
        customPresets,
      }),
    [params, enabledPlatformPresets, customPresets],
  );

  const capturable = useMemo(
    () => capturePresetFilters(specs, params),
    [specs, params],
  );

  const applyPreset = useCallback(
    (kind: "platform" | "custom", preset: PlatformPreset | CustomPreset) => {
      // A push, not a replace: selecting a preset is a deliberate jump to a
      // different search, and the back button should return to the one the
      // person was looking at before it.
      apply(applyPresetPatch(specs, kind, preset));
    },
    [apply, specs],
  );

  const applyPlatformPreset = useCallback(
    (preset: PlatformPreset) => applyPreset("platform", preset),
    [applyPreset],
  );

  const applyCustomPreset = useCallback(
    (preset: CustomPreset) => applyPreset("custom", preset),
    [applyPreset],
  );

  const saveCurrentSearch = useCallback(
    (name: string) => {
      const preset = store.create({ name, filters: capturable });

      if (!preset) {
        return undefined;
      }

      const committing =
        pendingPatch !== undefined && Object.keys(pendingPatch).length > 0;

      // The preset's own filters are never re-applied: they are, by
      // definition, what is already on screen, so a full apply would be a
      // navigation that changed nothing but the page number.
      //
      // What may still need applying is the staged edits the preset was
      // captured from. When there are none this is a marker-only write, so it
      // replaces rather than pushes and leaves pagination alone — there is no
      // previous view to go back to and no result set has moved. When there
      // are, this is an ordinary search change and behaves like one.
      apply(
        { ...pendingPatch, ...activatePresetPatch("custom", preset.id) },
        committing ? undefined : { history: "replace", resetPage: false },
      );

      return preset;
    },
    [apply, capturable, pendingPatch, store],
  );

  const renameCustomPreset = useCallback(
    (id: string, name: string) => store.rename(id, name),
    [store],
  );

  const deleteCustomPreset = useCallback(
    (id: string) => {
      const removed = store.remove(id);

      if (!removed) {
        return false;
      }

      // The search survives its preset. Someone tidying up their saved list
      // has said nothing about the results they are currently reading, and
      // clearing their filters as a side effect of a delete would be the one
      // outcome they could not have predicted. Only the marker goes — and
      // without resetting the page, since nothing about the result set moved.
      if (active.kind === "custom" && active.preset.id === id) {
        apply(deactivatePresetPatch(), {
          history: "replace",
          resetPage: false,
        });
      }

      return true;
    },
    [active, apply, store],
  );

  return {
    platformPresets: enabledPlatformPresets,
    customPresets,
    active,
    canSaveCurrentSearch: Object.keys(capturable).length > 0,
    applyPlatformPreset,
    applyCustomPreset,
    saveCurrentSearch,
    renameCustomPreset,
    deleteCustomPreset,
  };
}
