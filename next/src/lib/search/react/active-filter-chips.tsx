"use client";

/**
 * Search Core (React) - Active filter chips
 *
 * =============================================================================
 * One chip per value, not per filter
 * =============================================================================
 *
 * Someone who selected three categories gets three chips and can drop one
 * without losing the others. A per-filter chip would make removing a single
 * value a trip back into the picker to find and untick it — which is slower
 * than it sounds, because the picker is where they just were and the chip bar
 * is where they are looking.
 *
 * =============================================================================
 * Why it iterates every spec, not just the visible ones
 * =============================================================================
 *
 * A filter hidden by layout preference can still hold a value, and a
 * restriction with no on-screen representation is one the person cannot
 * explain or undo. The chip bar is the guarantee that everything narrowing the
 * results is visible somewhere, so it reads the full spec list rather than the
 * resolved layout.
 *
 * =============================================================================
 * Removing one value, not resetting the search
 * =============================================================================
 *
 * This component does one thing. Clearing everything is
 * `ClearAllFiltersButton`, which sits with the filter controls and is on screen
 * whether or not any chip is — the reset used to live in here as well, appear
 * only past two chips, and disappear again exactly when someone with one
 * stubborn filter needed it.
 */

import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import type { FilterSpec } from "../spec";
import { describeAllChips, type ChipContext } from "../spec-values";
import type { ParamPatch } from "../params";
import type { RawSearchParams } from "../types";

export interface ActiveFilterChipsProps {
  /** Every registered spec, including any the layout has hidden. */
  readonly specs: readonly FilterSpec[];

  readonly params: RawSearchParams;

  readonly onApply: (patch: ParamPatch) => void;

  /** Labels for relation options, so a chip reads "Web3", not "web3". */
  readonly chipContext?: ChipContext;

  readonly disabled?: boolean;

  readonly className?: string;
}

export function ActiveFilterChips({
  specs,
  params,
  onApply,
  chipContext,
  disabled,
  className,
}: ActiveFilterChipsProps) {
  const chips = describeAllChips(specs, params, chipContext);

  if (chips.length === 0) {
    return null;
  }

  return (
    <div
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      role="region"
      aria-label="Active filters"
    >
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          disabled={disabled}
          onClick={() => onApply(chip.remove)}
          // The filter's name is in the accessible label but not on screen:
          // "Online" is self-explanatory in context, and prefixing every chip
          // with "Mode:" would triple the bar's width for no added meaning.
          aria-label={`Remove ${chip.filterLabel} filter: ${chip.label}`}
          className={cn(
            "group inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-background py-1 pl-3 pr-2 text-sm font-medium transition-colors",
            "hover:border-foreground/25 hover:bg-muted",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <span className="truncate">{chip.label}</span>

          <XIcon
            className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
            aria-hidden
          />
        </button>
      ))}
    </div>
  );
}
