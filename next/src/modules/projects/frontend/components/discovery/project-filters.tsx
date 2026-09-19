"use client";

/**
 * Projects - Discovery filter bar
 *
 * The entire Project filter interface, on the same shape as
 * `src/modules/competitions/components/discovery/competition-filters.tsx` —
 * see that file for the fuller rationale. It contains no filter logic and no
 * per-filter branching; adding a filter means editing `search/ui.ts` and
 * `search/definition.ts`, never this file.
 *
 * No presets here — Projects has none yet, unlike Competitions. `FilterSheet`
 * treats `presets` as optional, so this is simply the same component with
 * that prop omitted, not a fork of it.
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
} from "@/lib/search/react";
import type { ChipContext } from "@/lib/search/client";

import { resolveProjectFilterLayout } from "../../../search/layout";
import {
  PROJECT_DEFAULT_SORT,
  PROJECT_FILTER_SPECS,
  PROJECT_SORT_OPTIONS,
} from "../../../search/ui";

export interface ProjectFiltersProps {
  /**
   * Options for the relation-backed filters (categories, technologies),
   * resolved on the server so the pickers are populated on first paint and
   * chips have real labels without a round trip.
   */
  readonly optionsMap: FilterOptionsMap;
}

export function ProjectFilters({ optionsMap }: ProjectFiltersProps) {
  const { params, apply, isPending } = useSearchParamsState();

  const layout = useMemo(() => resolveProjectFilterLayout(params), [params]);

  /** Lets a chip read "Artificial Intelligence" rather than "ai". */
  const chipContext = useMemo<ChipContext>(() => {
    const optionLabels: Record<string, Record<string, string>> = {};

    for (const [filterKey, options] of Object.entries(optionsMap)) {
      optionLabels[filterKey] = Object.fromEntries(
        options.map((option) => [option.value, option.label]),
      );
    }

    return { optionLabels };
  }, [optionsMap]);

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
            <ClearAllFiltersButton
              specs={PROJECT_FILTER_SPECS}
              params={params}
              onApply={apply}
              disabled={isPending}
            />

            <FilterSheet
              filters={layout.visible}
              clearableSpecs={PROJECT_FILTER_SPECS}
              params={params}
              onApply={apply}
              optionsMap={optionsMap}
              chipContext={chipContext}
              disabled={isPending}
            />

            <SortSelect
              options={PROJECT_SORT_OPTIONS}
              defaultKey={PROJECT_DEFAULT_SORT}
              params={params}
              onApply={apply}
              disabled={isPending}
              className="h-9 w-auto rounded-full text-sm"
            />
          </>
        }
      />

      <ActiveFilterChips
        specs={PROJECT_FILTER_SPECS}
        params={params}
        onApply={apply}
        chipContext={chipContext}
        disabled={isPending}
      />
    </div>
  );
}
