"use client";

/**
 * Competitions - Discovery filter bar
 *
 * =============================================================================
 * How small this file is, is the point
 * =============================================================================
 *
 * This is the entire Competition filter interface. It contains no filter
 * logic, no per-filter branching, and no knowledge of what any individual
 * filter does — it resolves a layout and hands it to generic components.
 *
 * Adding a nineteenth Competition filter means adding a spec in `search/ui.ts`
 * and a `toWhere` in `search/definition.ts`. This file does not change. That
 * was the requirement, and it is worth stating plainly where it is delivered.
 *
 * =============================================================================
 * Instant here, staged in the sheet
 * =============================================================================
 *
 * Quick-bar changes apply immediately: one click is one complete intent, and
 * the results should follow it. The sheet stages, because it is where several
 * filters are set together and each keystroke should not be a navigation.
 *
 * Both write to the URL, which stays the single source of truth for what is
 * applied.
 *
 * =============================================================================
 * Two views of one list, not two lists
 * =============================================================================
 *
 * The quick bar renders `layout.quick`; the sheet renders `layout.visible`,
 * which contains those same filters and the rest. They are two projections of
 * one resolved layout over one spec registry, so Category in the bar and
 * Category in the sheet are the same spec writing the same parameter — there is
 * no second filter set to keep in step, and no way for one to drift.
 */

import { useMemo } from "react";

import {
  ActiveFilterChips,
  ClearAllFiltersButton,
  FilterSheet,
  QuickFilterBar,
  SortSelect,
  useSearchParamsState,
  type FilterOptionsMap,
  type FilterSheetPresets,
} from "@/lib/search/react";
import type { ChipContext } from "@/lib/search/client";

import {
  resolveCompetitionFilterLayout,
  type CompetitionFilterScope,
} from "../../search/layout";
import {
  competitionAdminPresetStore,
  competitionLifecyclePresetStore,
  competitionPresetStore,
  COMPETITION_ADMIN_PLATFORM_PRESETS,
  COMPETITION_LIFECYCLE_PLATFORM_PRESETS,
  COMPETITION_PLATFORM_PRESETS,
} from "../../search/presets";
import {
  ADMIN_FILTER_SPECS,
  COMPETITION_DEFAULT_SORT,
  COMPETITION_FILTER_SPECS,
  COMPETITION_SORT_OPTIONS,
  LIFECYCLE_FILTER_SPECS,
} from "../../search/ui";

export interface CompetitionFiltersProps {
  /**
   * Options for the relation-backed filters, resolved on the server.
   *
   * Passed down rather than fetched here so the pickers are populated on first
   * paint and the labels are available for chips without a round trip.
   */
  readonly optionsMap: FilterOptionsMap;

  /**
   * Which spec list, layout and preset catalogue this render resolves against.
   *
   * `"admin"` adds the Record state filter ahead of everything else, clears
   * against `ADMIN_FILTER_SPECS` so "Clear all" also clears it, and offers its
   * own presets and saved-preset store. `"lifecycle"` adds automation state
   * and registration-opens instead, against `LIFECYCLE_FILTER_SPECS` and its
   * own preset store. `"public"` is exactly this component's behaviour
   * before scope existed.
   */
  readonly scope: CompetitionFilterScope;
}

export function CompetitionFilters({
  optionsMap,
  scope,
}: CompetitionFiltersProps) {
  const { params, apply, isPending } = useSearchParamsState();

  const layout = useMemo(
    () => resolveCompetitionFilterLayout(params, scope),
    [params, scope],
  );

  const clearableSpecs =
    scope === "admin"
      ? ADMIN_FILTER_SPECS
      : scope === "lifecycle"
        ? LIFECYCLE_FILTER_SPECS
        : COMPETITION_FILTER_SPECS;

  /**
   * Lets a chip read "Artificial Intelligence" rather than "ai".
   *
   * Built from the same option data the pickers use, so a chip and its
   * checkbox can never disagree about what a value is called.
   */
  const chipContext = useMemo<ChipContext>(() => {
    const optionLabels: Record<string, Record<string, string>> = {};

    for (const [filterKey, options] of Object.entries(optionsMap)) {
      optionLabels[filterKey] = Object.fromEntries(
        options.map((option) => [option.value, option.label]),
      );
    }

    return { optionLabels };
  }, [optionsMap]);

  /**
   * Each scope gets its own catalogue and its own saved-preset store — never
   * a shared one. An admin's "Deleted" preset means nothing on the public
   * page, and a visitor's saved search has no place next to Record state, so
   * the two must never read or write the same collection.
   *
   * No `default` case: widening `CompetitionFilterScope` with a third scope
   * makes this a compile error rather than a silent `undefined`.
   */
  const presets = useMemo<FilterSheetPresets>(() => {
    switch (scope) {
      case "public":
        return {
          platformPresets: COMPETITION_PLATFORM_PRESETS,
          store: competitionPresetStore,
        };
      case "admin":
        return {
          platformPresets: COMPETITION_ADMIN_PLATFORM_PRESETS,
          store: competitionAdminPresetStore,
        };
      case "lifecycle":
        return {
          platformPresets: COMPETITION_LIFECYCLE_PLATFORM_PRESETS,
          store: competitionLifecyclePresetStore,
        };
    }
  }, [scope]);

  return (
    <div className="space-y-3">
      <QuickFilterBar
        filters={layout.quick}
        params={params}
        onApply={apply}
        optionsMap={optionsMap}
        disabled={isPending}
        trailing={
          <>
            {/*
              Always on screen, disabled when nothing is applied. The way back
              to an unfiltered list must not itself be behind a filter — or
              behind the sheet, which is where the only other one lives.
            */}
            <ClearAllFiltersButton
              specs={clearableSpecs}
              params={params}
              onApply={apply}
              disabled={isPending}
            />

            <FilterSheet
              // Every visible filter, quick ones included. "All filters" that
              // omitted the five on the page would be the most confusing
              // possible thing to call it.
              filters={layout.visible}
              // Clears every registered filter, not only the rendered
              // sections. Someone pressing "Clear all filters" from in here
              // means all of it, including anything a layout has hidden.
              clearableSpecs={clearableSpecs}
              params={params}
              onApply={apply}
              optionsMap={optionsMap}
              chipContext={chipContext}
              presets={presets}
              disabled={isPending}
            />

            <SortSelect
              options={COMPETITION_SORT_OPTIONS}
              defaultKey={COMPETITION_DEFAULT_SORT}
              params={params}
              onApply={apply}
              disabled={isPending}
              className="h-9 w-auto rounded-full text-sm"
            />
          </>
        }
      />

      {/*
        Reads every registered spec rather than the resolved layout, so a
        filter hidden by preference still shows a removable chip while it holds
        a value. A restriction with no on-screen representation is one the
        person cannot explain or undo.
      */}
      <ActiveFilterChips
        specs={clearableSpecs}
        params={params}
        onApply={apply}
        chipContext={chipContext}
        disabled={isPending}
      />
    </div>
  );
}
