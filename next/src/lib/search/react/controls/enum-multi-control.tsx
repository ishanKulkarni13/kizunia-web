"use client";

/**
 * Search Core (React) - Enum multi-select
 *
 * Renders as pills for short option sets and as a checkbox list for longer
 * ones. Both are the same control and the same value; only the presentation
 * differs, and `usesPillDisplay` decides which — so the threshold is one
 * number in the spec layer rather than a judgement repeated per filter.
 *
 * Pills are used where the whole vocabulary fits on one line and a person
 * scans it at a glance ("Online / In person / Hybrid"). A checkbox list is
 * used where they must read to choose, and where a scroll area is preferable
 * to a wrapping thicket of buttons.
 */

import { CheckIcon } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

import type { EnumMultiSpec } from "../../spec";
import { usesPillDisplay } from "../../spec";
import type { FilterControlProps } from "./types";

export function EnumMultiControl({
  spec,
  value,
  onChange,
  counts,
  disabled,
}: FilterControlProps<EnumMultiSpec>) {
  const selected = new Set(value ?? []);

  /**
   * Toggling never produces an empty array — it produces `undefined`.
   *
   * An empty selection means "no restriction", and the value layer encodes
   * that by removing the parameter. Emitting `[]` instead would round-trip
   * through the URL as an absent filter anyway, so normalising here keeps the
   * control's output identical to what will be read back.
   */
  const toggle = (optionValue: string) => {
    const next = new Set(selected);

    if (next.has(optionValue)) {
      next.delete(optionValue);
    } else {
      next.add(optionValue);
    }

    // Preserve the spec's option order rather than click order, so the URL for
    // one selection is always the same string regardless of how it was built.
    const ordered = spec.options
      .map((option) => option.value)
      .filter((optionValue) => next.has(optionValue));

    onChange(ordered.length > 0 ? ordered : undefined);
  };

  if (usesPillDisplay(spec)) {
    return (
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={spec.label}>
        {spec.options.map((option) => {
          const isSelected = selected.has(option.value);

          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              aria-pressed={isSelected}
              onClick={() => toggle(option.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                "disabled:cursor-not-allowed disabled:opacity-50",
                isSelected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-foreground hover:bg-muted",
              )}
            >
              {isSelected && <CheckIcon className="size-3.5" aria-hidden />}
              {option.label}
              {counts?.[option.value] !== undefined && (
                <span
                  className={cn(
                    "tabular-nums text-xs",
                    isSelected
                      ? "text-primary-foreground/70"
                      : "text-muted-foreground",
                  )}
                >
                  {counts[option.value]}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  // Above roughly eight options a wrapping pill field becomes hard to scan and
  // tall enough to push everything below it off screen, so the list scrolls
  // within a bounded height instead.
  const body = (
    <div className="space-y-0.5">
      {spec.options.map((option) => {
        const id = `${spec.key}-${option.value}`;
        const isSelected = selected.has(option.value);

        return (
          <div
            key={option.value}
            className="flex items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/60"
          >
            <Checkbox
              id={id}
              checked={isSelected}
              disabled={disabled}
              onCheckedChange={() => toggle(option.value)}
              className="mt-0.5"
            />

            <Label
              htmlFor={id}
              className="flex-1 cursor-pointer text-sm font-normal leading-snug"
            >
              <span className="flex items-baseline justify-between gap-2">
                <span>{option.label}</span>

                {counts?.[option.value] !== undefined && (
                  <span className="tabular-nums text-xs text-muted-foreground">
                    {counts[option.value]}
                  </span>
                )}
              </span>

              {option.hint && (
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {option.hint}
                </span>
              )}
            </Label>
          </div>
        );
      })}
    </div>
  );

  return spec.options.length > 8 ? (
    <ScrollArea className="h-56 pr-2">{body}</ScrollArea>
  ) : (
    body
  );
}
