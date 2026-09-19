"use client";

/**
 * Search Core (React) - Sort control
 *
 * Sorting is URL state like everything else, so it composes with filters and
 * survives sharing and refreshing.
 *
 * Selecting the default removes the parameter rather than writing it, so one
 * view has one URL. Two URLs for the same result set would split analytics,
 * weaken caching and make saved-search comparison unreliable.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { readSortToken, sortPatch, type ParamPatch } from "../params";
import type { SortOptionSummary } from "../sort";
import type { RawSearchParams } from "../types";

export interface SortSelectProps {
  /**
   * The available sorts, projected from the server registry.
   *
   * Passed as plain data because a `SortRegistry` carries the entity's Prisma
   * `orderBy` shape and must not cross into a client bundle.
   */
  readonly options: readonly SortOptionSummary[];

  readonly defaultKey: string;

  readonly params: RawSearchParams;

  readonly onApply: (patch: ParamPatch) => void;

  readonly disabled?: boolean;

  readonly className?: string;
}

export function SortSelect({
  options,
  defaultKey,
  params,
  onApply,
  disabled,
  className,
}: SortSelectProps) {
  const token = readSortToken(params);

  // An unrecognised token falls back to the default here, mirroring what
  // `resolveSort` does on the server. A stale link naming a removed sort then
  // shows the sort actually in effect, rather than an empty control that
  // disagrees with the results.
  const active = options.some((option) => option.key === token)
    ? (token as string)
    : defaultKey;

  return (
    <Select
      value={active}
      disabled={disabled}
      onValueChange={(next) => onApply(sortPatch(next, defaultKey))}
    >
      <SelectTrigger className={className} aria-label="Sort results">
        <span className="text-muted-foreground">Sort:&nbsp;</span>
        <SelectValue />
      </SelectTrigger>

      <SelectContent align="end">
        {options.map((option) => (
          <SelectItem key={option.key} value={option.key}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
