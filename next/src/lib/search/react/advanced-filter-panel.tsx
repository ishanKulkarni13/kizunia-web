"use client";

/**
 * Search Core (React) - Advanced filter panel
 *
 * A vertical list of filter sections, each one a label, an optional
 * explanation, and its control.
 *
 * Renders whatever the resolved layout gives it, in the order it gives it. It
 * has no knowledge of which filters exist, which entity it is filtering, or
 * how many sections there will be — so promoting a filter, hiding one, or
 * adding one changes nothing here.
 *
 * Sections are collapsed by default once past a threshold, and any section
 * holding a value opens regardless. A panel of eighteen expanded controls is
 * a wall; a panel of eighteen collapsed ones hides the two that are actually
 * in use.
 */

import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import type { ResolvedFilter } from "../layout";
import { readFilterValue, writeFilterValue } from "../spec-values";
import type { ParamPatch } from "../params";
import type { RawSearchParams } from "../types";
import { FilterControl } from "./controls";
import type { FilterCountsMap, FilterOptionsMap } from "./types";

/**
 * Above this many sections, collapse them by default.
 *
 * Below it the whole panel is scannable at once and collapsing would add a
 * click per filter for no gain.
 */
const COLLAPSE_THRESHOLD = 5;

export interface AdvancedFilterPanelProps {
  readonly filters: readonly ResolvedFilter[];

  /**
   * Parameters the controls bind to.
   *
   * In a staged surface this is the applied search plus pending edits, so the
   * panel previews its own unapplied state while the results behind it still
   * reflect what is actually applied.
   */
  readonly params: RawSearchParams;

  /**
   * Records a change.
   *
   * Wired to `stage` in a staged surface and to `apply` in an instant one —
   * the panel does not know or care which, which is what lets one
   * implementation serve both.
   */
  readonly onChange: (patch: ParamPatch) => void;

  readonly optionsMap?: FilterOptionsMap;

  readonly countsMap?: FilterCountsMap;

  readonly disabled?: boolean;

  readonly className?: string;
}

export function AdvancedFilterPanel({
  filters,
  params,
  onChange,
  optionsMap,
  countsMap,
  disabled,
  className,
}: AdvancedFilterPanelProps) {
  const collapsible = filters.length > COLLAPSE_THRESHOLD;

  if (filters.length === 0) {
    return (
      <p className={cn("py-8 text-center text-sm text-muted-foreground", className)}>
        No additional filters available.
      </p>
    );
  }

  return (
    <div className={cn("divide-y", className)}>
      {filters.map((entry) => (
        <FilterSection
          key={entry.spec.key}
          entry={entry}
          params={params}
          onChange={onChange}
          optionsMap={optionsMap}
          countsMap={countsMap}
          disabled={disabled}
          collapsible={collapsible}
        />
      ))}
    </div>
  );
}

function FilterSection({
  entry,
  params,
  onChange,
  optionsMap,
  countsMap,
  disabled,
  collapsible,
}: {
  entry: ResolvedFilter;
  params: RawSearchParams;
  onChange: (patch: ParamPatch) => void;
  optionsMap?: FilterOptionsMap;
  countsMap?: FilterCountsMap;
  disabled?: boolean;
  collapsible: boolean;
}) {
  const { spec } = entry;

  const value = readFilterValue(spec, params);

  const isActive = value !== undefined;

  // A filter already in use opens itself, so nothing that is narrowing the
  // results is hidden behind a collapsed heading the person has to think to
  // expand.
  const [open, setOpen] = useState(!collapsible || isActive);

  const body = (
    <div className="pb-4">
      {spec.description && (
        <p className="mb-2.5 text-xs leading-relaxed text-muted-foreground">
          {spec.description}
        </p>
      )}

      <FilterControl
        spec={spec}
        value={value}
        onChange={(next) => onChange(writeFilterValue(spec, next))}
        options={optionsMap?.[spec.key]}
        counts={countsMap?.[spec.key]}
        disabled={disabled}
      />
    </div>
  );

  if (!collapsible) {
    return (
      <section className="py-4">
        <h3 className="mb-2 text-sm font-semibold">{spec.label}</h3>
        {body}
      </section>
    );
  }

  return (
    <section className="py-1">
      <h3>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-2 rounded-md py-3 text-left text-sm font-semibold transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex items-center gap-2">
            {spec.label}

            {isActive && (
              <span
                aria-label="has a value"
                className="size-1.5 rounded-full bg-primary"
              />
            )}

            {entry.revealedBecauseActive && (
              <span className="text-xs font-normal text-muted-foreground">
                (hidden, but active)
              </span>
            )}
          </span>

          <ChevronDownIcon
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      </h3>

      {open && body}
    </section>
  );
}
