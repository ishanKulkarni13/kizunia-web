"use client";

/**
 * Search Core (React) - Clear all filters
 *
 * =============================================================================
 * Why this is its own control, and always on screen
 * =============================================================================
 *
 * "How do I get back to everything?" is the question a filtered listing has to
 * be able to answer at any moment, including the moment someone has narrowed
 * themselves into an empty result and stopped trusting the page.
 *
 * It used to be answered in two places that were both conditional: a button
 * that appeared in the chip bar only once *two* filters were set, and one
 * inside the advanced sheet, which is behind a click. Someone with a single
 * filter applied and the sheet closed had no reset at all in front of them.
 *
 * So the control is unconditional and lives beside the filter controls. With
 * nothing applied it is disabled rather than hidden — a control that vanishes
 * teaches nobody that it exists, and its disabled state is itself the answer to
 * "am I filtered right now?".
 *
 * It clears through `clearAllFiltersPatch` like every other reset in the
 * system. There is exactly one definition of what "all" means, and it is not
 * in this file.
 */

import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { ParamPatch } from "../params";
import type { FilterSpec } from "../spec";
import { activeFilterCount, clearAllFiltersPatch } from "../spec-values";
import type { RawSearchParams } from "../types";

export interface ClearAllFiltersButtonProps {
  /**
   * Every registered filter, not the resolved layout.
   *
   * A filter hidden by layout preference can still hold a value, and a reset
   * that skipped it would leave the results narrowed by something with no
   * on-screen representation.
   */
  readonly specs: readonly FilterSpec[];

  readonly params: RawSearchParams;

  readonly onApply: (patch: ParamPatch) => void;

  readonly disabled?: boolean;

  readonly label?: string;

  readonly className?: string;
}

export function ClearAllFiltersButton({
  specs,
  params,
  onApply,
  disabled,
  label = "Clear all filters",
  className,
}: ClearAllFiltersButtonProps) {
  const hasFilters = activeFilterCount(specs, params) > 0;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={disabled || !hasFilters}
      onClick={() => onApply(clearAllFiltersPatch(specs))}
      // Spelled out rather than shortened to "Clear". The word that matters is
      // "all": it is what distinguishes this from removing the one chip the
      // person happens to be looking at.
      className={cn(
        "h-9 gap-1.5 rounded-full px-3 text-sm text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <XIcon className="size-3.5" aria-hidden />
      {label}
    </Button>
  );
}
