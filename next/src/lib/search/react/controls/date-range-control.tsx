"use client";

/**
 * Search Core (React) - Date range
 *
 * Presets first, calendar second.
 *
 * Almost every date filter a person applies to a listing is relative —
 * "closing in the next month", "starting this quarter". Making them express
 * that by picking two absolute dates is work the interface can do for them.
 * The calendar remains for the cases a preset does not cover.
 *
 * Presets are stored in the spec relatively and resolved against today at the
 * moment they are clicked, so a saved search using "next 30 days" keeps
 * meaning the next 30 days. What is written to the URL is always absolute,
 * because the applied search must be unambiguous.
 */

import { useState } from "react";
import type { DateRange } from "react-day-picker";

import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

import type { DateRangeSpec, DateRangeValue } from "../../spec";
import type { FilterControlProps } from "./types";

/**
 * Formats a date as a bare calendar day in the *viewer's* local reckoning.
 *
 * `toISOString` is deliberately not used: it converts to UTC first, so a date
 * picked late in the evening in IST would be written as the previous day. The
 * person selected a square on a calendar, and that is the day that must be
 * stored.
 */
function toBareDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/** Parses a stored bound back into a `Date` the calendar can highlight. */
function fromStored(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function addDays(days: number): Date {
  const date = new Date();

  date.setDate(date.getDate() + days);

  return date;
}

export function DateRangeControl({
  spec,
  value,
  onChange,
  disabled,
}: FilterControlProps<DateRangeSpec>) {
  const [showCalendar, setShowCalendar] = useState(false);

  const selected: DateRange | undefined = value
    ? { from: fromStored(value.from), to: fromStored(value.to) }
    : undefined;

  const applyPreset = (fromDays?: number, toDays?: number) => {
    const next: DateRangeValue = {
      from: fromDays === undefined ? undefined : toBareDate(addDays(fromDays)),
      to: toDays === undefined ? undefined : toBareDate(addDays(toDays)),
    };

    onChange(next.from || next.to ? next : undefined);
  };

  /**
   * Whether a preset describes the currently applied range.
   *
   * Compared by the dates it would produce today rather than by storing which
   * preset was clicked. That keeps the URL free of presentation state, and it
   * correctly stops showing a preset as active once its window has moved on.
   */
  const isPresetActive = (fromDays?: number, toDays?: number): boolean => {
    if (!value) {
      return false;
    }

    const from = fromDays === undefined ? undefined : toBareDate(addDays(fromDays));
    const to = toDays === undefined ? undefined : toBareDate(addDays(toDays));

    return value.from === from && value.to === to;
  };

  return (
    <div className="space-y-3">
      {spec.presets && spec.presets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {spec.presets.map((preset) => {
            const active = isPresetActive(preset.fromDays, preset.toDays);

            return (
              <button
                key={preset.id}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                onClick={() =>
                  active
                    ? onChange(undefined)
                    : applyPreset(preset.fromDays, preset.toDays)
                }
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:bg-muted",
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">
          {value?.from || value?.to ? (
            <span className="tabular-nums text-foreground">
              {value.from ?? "…"} → {value.to ?? "…"}
            </span>
          ) : (
            "Any date"
          )}
        </span>

        <div className="flex items-center gap-2">
          {value && (
            <button
              type="button"
              onClick={() => onChange(undefined)}
              className="text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Clear
            </button>
          )}

          <button
            type="button"
            disabled={disabled}
            onClick={() => setShowCalendar((open) => !open)}
            aria-expanded={showCalendar}
            className="text-xs font-medium text-primary underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {showCalendar ? "Hide calendar" : "Pick dates"}
          </button>
        </div>
      </div>

      {showCalendar && (
        <div className="rounded-lg border p-1">
          <Calendar
            mode="range"
            selected={selected}
            disabled={disabled}
            onSelect={(range: DateRange | undefined) => {
              if (!range?.from && !range?.to) {
                onChange(undefined);
                return;
              }

              onChange({
                from: range?.from ? toBareDate(range.from) : undefined,
                to: range?.to ? toBareDate(range.to) : undefined,
              });
            }}
          />
        </div>
      )}
    </div>
  );
}
