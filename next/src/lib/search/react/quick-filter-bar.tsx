"use client";

/**
 * Search Core (React) - Quick filter bar
 *
 * The row of filters someone reaches for constantly, applied instantly.
 *
 * Text filters render inline and full-width rather than inside a popover: a
 * search box is the first thing a person looks for on a listing, and putting
 * it behind a click would be a strange thing to do to it. Everything else
 * renders as a compact popover trigger, so the bar stays one or two rows deep
 * however many filters are promoted into it.
 *
 * Which filters appear here is decided by `resolveFilterLayout`, not by this
 * component. Promoting a filter into the quick bar is a layout change, and
 * eventually a user preference — never an edit to this file.
 */

import { cn } from "@/lib/utils";

import type { ResolvedFilter } from "../layout";
import { readFilterValue, writeFilterValue } from "../spec-values";
import type { ParamPatch } from "../params";
import type { RawSearchParams } from "../types";
import { FilterControl } from "./controls";
import { FilterPopover } from "./filter-popover";
import type { FilterCountsMap, FilterOptionsMap } from "./types";

export interface QuickFilterBarProps {
  readonly filters: readonly ResolvedFilter[];

  readonly params: RawSearchParams;

  readonly onApply: (patch: ParamPatch) => void;

  readonly optionsMap?: FilterOptionsMap;

  readonly countsMap?: FilterCountsMap;

  readonly disabled?: boolean;

  /** Rendered at the end of the control row — the sheet trigger and sort. */
  readonly trailing?: React.ReactNode;

  readonly className?: string;
}

export function QuickFilterBar({
  filters,
  params,
  onApply,
  optionsMap,
  countsMap,
  disabled,
  trailing,
  className,
}: QuickFilterBarProps) {
  const textFilters = filters.filter((entry) => entry.spec.kind === "text");

  const popoverFilters = filters.filter((entry) => entry.spec.kind !== "text");

  return (
    <div className={cn("space-y-3", className)}>
      {textFilters.map((entry) => (
        <FilterControl
          key={entry.spec.key}
          spec={entry.spec}
          value={readFilterValue(entry.spec, params)}
          onChange={(next) =>
            // Replaces rather than pushes: a debounced text field emits every
            // few hundred milliseconds, and pushing each one would bury the
            // previous page under a history entry per word.
            onApply(writeFilterValue(entry.spec, next))
          }
          disabled={disabled}
        />
      ))}

      <div className="flex flex-wrap items-center gap-2">
        {popoverFilters.map((entry) => (
          <FilterPopover
            key={entry.spec.key}
            spec={entry.spec}
            params={params}
            onApply={onApply}
            optionsMap={optionsMap}
            countsMap={countsMap}
            disabled={disabled}
          />
        ))}

        {trailing && (
          <div className="ml-auto flex items-center gap-2">{trailing}</div>
        )}
      </div>
    </div>
  );
}
