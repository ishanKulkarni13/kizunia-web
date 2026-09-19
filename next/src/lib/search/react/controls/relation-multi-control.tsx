"use client";

/**
 * Search Core (React) - Relation multi-select
 *
 * For values that come from a table rather than an enum — categories,
 * technologies, authors. Unlike an enum, the vocabulary is open and grows, so
 * the control has to stay usable at ten options and at four hundred.
 *
 * Above a threshold it turns on a search box. Below it, a search box would be
 * a step the person has to skip past to reach a list they can already see.
 *
 * Options arrive as props. The control never fetches: the page has already
 * loaded the taxonomy in order to render chips with real labels, and fetching
 * again here would duplicate that request and flash an empty list on mount.
 */

import { useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";

import type { RelationMultiSpec } from "../../spec";
import { usesOptionSearch } from "../../spec";
import type { FilterControlProps } from "./types";

export function RelationMultiControl({
  spec,
  value,
  onChange,
  options = [],
  counts,
  disabled,
}: FilterControlProps<RelationMultiSpec>) {
  const [query, setQuery] = useState("");

  const selected = useMemo(() => new Set(value ?? []), [value]);

  const showSearch = usesOptionSearch(spec, options.length);

  const visible = useMemo(() => {
    const trimmed = query.trim().toLowerCase();

    if (!trimmed) {
      return options;
    }

    return options.filter((option) =>
      option.label.toLowerCase().includes(trimmed),
    );
  }, [options, query]);

  /**
   * Selected options that the current option list does not contain.
   *
   * A slug can be in the URL while absent from the loaded list — a shared link
   * naming something since renamed, or a list truncated by its limit. Rendering
   * it anyway means the person can always see, and switch off, every filter
   * actually being applied. Silently omitting it would leave results narrowed
   * by something with no on-screen representation.
   */
  const orphaned = useMemo(() => {
    const known = new Set(options.map((option) => option.value));

    return [...selected].filter((entry) => !known.has(entry));
  }, [options, selected]);

  const toggle = (optionValue: string) => {
    const next = new Set(selected);

    if (next.has(optionValue)) {
      next.delete(optionValue);
    } else {
      next.add(optionValue);
    }

    // Sorted so one selection always serialises to one string, whatever order
    // it was clicked in — which keeps saved-search comparison meaningful.
    const ordered = [...next].sort();

    onChange(ordered.length > 0 ? ordered : undefined);
  };

  const renderRow = (
    optionValue: string,
    label: string,
    count?: number,
  ) => {
    const id = `${spec.key}-${optionValue}`;

    return (
      <div
        key={optionValue}
        className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/60"
      >
        <Checkbox
          id={id}
          checked={selected.has(optionValue)}
          disabled={disabled}
          onCheckedChange={() => toggle(optionValue)}
        />

        <Label
          htmlFor={id}
          className="flex flex-1 cursor-pointer items-baseline justify-between gap-2 text-sm font-normal"
        >
          <span className="truncate">{label}</span>

          {count !== undefined && (
            <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
              {count}
            </span>
          )}
        </Label>
      </div>
    );
  };

  return (
    <div className="space-y-2">
      {showSearch && (
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />

          <Input
            value={query}
            disabled={disabled}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={spec.searchPlaceholder ?? `Search ${spec.label}`}
            aria-label={`Search ${spec.label}`}
            className="h-8 pl-8 text-sm"
          />
        </div>
      )}

      {/* A fixed height, not `max-h-*`: Radix's Viewport sizes itself via
          `height: 100%`, which does not reliably resolve against a parent
          whose height is only capped by `max-height` — the list would then
          overflow the box and spill onto whatever renders after it, which is
          exactly what happened here before this was a fixed height. */}
      <ScrollArea className="h-56 pr-2">
        <div className="space-y-0.5">
          {orphaned.map((entry) => renderRow(entry, entry))}

          {visible.map((option) =>
            renderRow(option.value, option.label, counts?.[option.value]),
          )}

          {visible.length === 0 && orphaned.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              {options.length === 0
                ? `No ${spec.label.toLowerCase()} available yet.`
                : `Nothing matches “${query}”.`}
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
