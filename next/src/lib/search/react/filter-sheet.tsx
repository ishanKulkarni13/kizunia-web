"use client";

/**
 * Search Core (React) - The complete filter surface
 *
 * =============================================================================
 * "All filters" has to mean all of them
 * =============================================================================
 *
 * This sheet used to render only the filters the layout had pushed *out* of the
 * quick bar, which made its trigger a lie: someone who could see Category on
 * the page opened "All filters", found no Category, and had no way to know
 * whether the rest of the list was complete either.
 *
 * It now renders every visible filter, quick ones included. The quick bar is a
 * set of shortcuts to the common few, not a separate half of the vocabulary —
 * and both bind to the same parameters through the same specs, so a filter set
 * in one place is set in the other by construction rather than by agreement.
 *
 * =============================================================================
 * Why this surface stages instead of applying instantly
 * =============================================================================
 *
 * The advanced sheet is where several filters are set in one sitting: a date
 * range, a team size, three eligibilities. Applying each edit as it happens
 * would fire a navigation per checkbox, make the list behind the sheet thrash,
 * and leave nothing to cancel if the person changes their mind halfway.
 *
 * So edits accumulate in a buffer and commit as one patch — one navigation,
 * one history entry, one undo.
 *
 * =============================================================================
 * Mobile is the same component
 * =============================================================================
 *
 * The sheet is full-width below the small breakpoint and a side panel above
 * it. Building a separate mobile drawer would mean two implementations of the
 * same staged-edit logic, and the second one would be the one that fell behind.
 */

import { useState } from "react";
import { SlidersHorizontalIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import type { ResolvedFilter } from "../layout";
import type { CustomPresetStore } from "../preset-storage";
import type { PlatformPreset } from "../presets";
import type { FilterSpec } from "../spec";
import {
  activeFilterCount,
  clearAllFiltersPatch,
  type ChipContext,
} from "../spec-values";
import type { ParamPatch } from "../params";
import type { RawSearchParams } from "../types";
import { AdvancedFilterPanel } from "./advanced-filter-panel";
import { PresetPanel } from "./preset-panel";
import type { FilterCountsMap, FilterOptionsMap } from "./types";
import type { ApplySearchOptions } from "./use-search-params-state";
import { useStagedParams } from "./use-staged-params";

/**
 * What a caller supplies to put presets at the top of the panel.
 *
 * Optional as a whole: a surface with no curated starting points renders the
 * filters alone, rather than an empty "Presets" heading.
 */
export interface FilterSheetPresets {
  readonly platformPresets: readonly PlatformPreset[];

  readonly store: CustomPresetStore;
}

export interface FilterSheetProps {
  /**
   * Sections to render, in resolved layout order.
   *
   * Should be every *visible* filter — see the note at the top of this file.
   * Filters a layout has hidden stay hidden: that is a preference, and this
   * sheet is not the place to overrule one.
   */
  readonly filters: readonly ResolvedFilter[];

  /**
   * Specs a Clear all inside this sheet should clear.
   *
   * Usually every registered filter, not just this sheet's sections — someone
   * pressing "Clear all" means all of it, including the quick bar behind them.
   */
  readonly clearableSpecs: readonly FilterSpec[];

  readonly params: RawSearchParams;

  /**
   * The full navigation seam, options included.
   *
   * The filter controls only ever call it with a patch; the preset section
   * needs to say how a change should affect history and pagination.
   */
  readonly onApply: (patch: ParamPatch, options?: ApplySearchOptions) => void;

  readonly optionsMap?: FilterOptionsMap;

  readonly countsMap?: FilterCountsMap;

  /** Presets to offer above the filters. Omitted, the section is not shown. */
  readonly presets?: FilterSheetPresets;

  /** Labels for relation options, so a summary reads "Web3", not "web3". */
  readonly chipContext?: ChipContext;

  readonly triggerLabel?: string;

  readonly disabled?: boolean;

  readonly className?: string;
}

export function FilterSheet({
  filters,
  clearableSpecs,
  params,
  onApply,
  optionsMap,
  countsMap,
  presets,
  chipContext,
  triggerLabel = "All filters",
  disabled,
  className,
}: FilterSheetProps) {
  const [open, setOpen] = useState(false);

  const staged = useStagedParams(params, open);

  // Counted across every clearable filter rather than the sections rendered
  // here. Those are now the same list in practice, but the badge is a promise
  // about the *search* — "you have three filters on" — and a layout that hid
  // one must not be able to make that number quietly wrong.
  const activeCount = activeFilterCount(clearableSpecs, params);

  const commit = () => {
    onApply(staged.pendingPatch);
    setOpen(false);
  };

  const clearAll = () => {
    // Applied straight away rather than staged. "Clear all" is unambiguous and
    // its own confirmation — requiring Apply after it would read as though the
    // button had not worked.
    onApply(clearAllFiltersPatch(clearableSpecs));
    staged.reset();
    setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn("h-9 gap-1.5 rounded-full", className)}
        >
          <SlidersHorizontalIcon className="size-3.5" aria-hidden />
          {triggerLabel}

          {activeCount > 0 && (
            <span className="ml-0.5 inline-flex size-5 items-center justify-center rounded-full bg-primary text-xs font-semibold tabular-nums text-primary-foreground">
              {activeCount}
            </span>
          )}
        </Button>
      </SheetTrigger>

      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>Filters</SheetTitle>

          <SheetDescription>
            Every filter is in here. Changes apply when you press Apply, so you
            can set several at once.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          {presets && (
            <PresetPanel
              // Every registered filter, not this sheet's sections: a preset
              // clears the whole search, including anything a layout hid.
              specs={clearableSpecs}
              params={params}
              onApply={onApply}
              platformPresets={presets.platformPresets}
              store={presets.store}
              // So "save these filters" saves what is on screen, staged edits
              // included, and commits them in the same navigation.
              pendingPatch={staged.pendingPatch}
              chipContext={chipContext}
              disabled={disabled}
              onApplied={() => {
                staged.reset();
                setOpen(false);
              }}
              // Stays open: the staged edits have just been applied along with
              // the save, so the buffer is spent, and the panel now shows the
              // new preset in the saved list.
              onSaved={staged.reset}
              className="border-b py-5"
            />
          )}

          <AdvancedFilterPanel
            filters={filters}
            params={staged.params}
            onChange={staged.stage}
            optionsMap={optionsMap}
            countsMap={countsMap}
            disabled={disabled}
          />
        </div>

        <SheetFooter className="flex-row items-center justify-between gap-3 border-t px-5 py-4">
          <Button
            type="button"
            variant="ghost"
            onClick={clearAll}
            className="text-muted-foreground hover:text-foreground"
          >
            Clear all filters
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>

            <Button
              type="button"
              onClick={commit}
              disabled={!staged.hasPendingChanges}
            >
              Apply
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
