"use client";

/**
 * Search Core (React) - Quick-bar filter popover
 *
 * One filter, presented as a labelled trigger that opens its control.
 *
 * The trigger carries the filter's current state: how many values are
 * selected, or the single value when there is one. That matters because the
 * quick bar is scanned rather than read — a row of identical buttons saying
 * only "Mode", "Category", "Difficulty" forces the person to open each one to
 * discover what is applied.
 *
 * Changes here are applied immediately. The quick bar is for single decisions
 * that mean something on their own; staging them behind an Apply button would
 * add a step to the one place speed matters most. Multi-edit surfaces stage
 * instead — see `AdvancedFilterPanel`.
 */

import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import type { FilterSpec, ValueOfSpec } from "../spec";
import { optionLabel } from "../spec";
import { readFilterValue, writeFilterValue } from "../spec-values";
import type { ParamPatch } from "../params";
import type { RawSearchParams } from "../types";
import { FilterControl } from "./controls";
import type { FilterCountsMap, FilterOptionsMap } from "./types";

export interface FilterPopoverProps {
  readonly spec: FilterSpec;

  readonly params: RawSearchParams;

  readonly onApply: (patch: ParamPatch) => void;

  readonly optionsMap?: FilterOptionsMap;

  readonly countsMap?: FilterCountsMap;

  readonly disabled?: boolean;
}

/**
 * Summarises a filter's state for its trigger.
 *
 * Shows the value itself when there is exactly one — "Online" is more useful
 * than "Mode · 1" and costs no more room. Falls back to a count above that,
 * because listing four category names would overflow the button.
 */
function summarise(
  spec: FilterSpec,
  value: ValueOfSpec<FilterSpec> | undefined,
  optionsMap?: FilterOptionsMap,
): { label: string; isActive: boolean } {
  if (value === undefined) {
    return { label: spec.label, isActive: false };
  }

  switch (spec.kind) {
    case "enum-multi":
    case "relation-multi":
    case "text-any": {
      const values = value as readonly string[];

      if (values.length === 1) {
        const options =
          spec.kind === "enum-multi"
            ? spec.options
            : (optionsMap?.[spec.key] ?? []);

        return {
          label:
            spec.kind === "text-any"
              ? values[0]
              : optionLabel(options, values[0]),
          isActive: true,
        };
      }

      return { label: `${spec.label} · ${values.length}`, isActive: true };
    }

    case "place": {
      const place = value as { label?: string };

      return { label: place.label ?? spec.label, isActive: true };
    }

    case "number-bound":
      return { label: `${spec.label} · ${value as number}`, isActive: true };

    case "team-size": {
      const teamSize = value as { min?: number; max?: number };

      if (teamSize.min !== undefined && teamSize.min === teamSize.max) {
        return {
          label: teamSize.min === 1 ? "Solo" : `Team of ${teamSize.min}`,
          isActive: true,
        };
      }

      return { label: spec.label, isActive: true };
    }

    default:
      return { label: spec.label, isActive: true };
  }
}

export function FilterPopover({
  spec,
  params,
  onApply,
  optionsMap,
  countsMap,
  disabled,
}: FilterPopoverProps) {
  const [open, setOpen] = useState(false);

  const value = readFilterValue(spec, params);

  const { label, isActive } = summarise(spec, value, optionsMap);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label={`${spec.label} filter`}
          className={cn(
            "h-9 max-w-56 gap-1.5 rounded-full",
            isActive &&
              "border-primary/40 bg-primary/10 text-foreground hover:bg-primary/15",
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" aria-hidden />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 p-3">
        <div className="mb-2.5 flex items-baseline justify-between gap-2">
          <p className="text-sm font-semibold">{spec.label}</p>

          {isActive && (
            <button
              type="button"
              onClick={() => onApply(writeFilterValue(spec, undefined))}
              className="text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Clear
            </button>
          )}
        </div>

        {spec.description && (
          <p className="mb-2.5 text-xs leading-relaxed text-muted-foreground">
            {spec.description}
          </p>
        )}

        <FilterControl
          spec={spec}
          value={value}
          onChange={(next) => onApply(writeFilterValue(spec, next))}
          options={optionsMap?.[spec.key]}
          counts={countsMap?.[spec.key]}
          disabled={disabled}
        />
      </PopoverContent>
    </Popover>
  );
}
