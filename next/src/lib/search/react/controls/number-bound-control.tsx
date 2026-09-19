"use client";

/**
 * Search Core (React) - Numeric bound
 *
 * Two presentations of one filter, chosen by how many values it can take.
 *
 * A wide range — "at most 50 members" — is chosen by feel, and a slider makes
 * both the range and the current position visible in a way a bare number input
 * does not. A short range is different: "a team of 1, 2, 3 or 4" is a small set
 * of named answers, and asking someone to drag a handle to land on one of eight
 * positions is strictly worse than showing them the eight.
 */

import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import type { NumberBoundSpec } from "../../spec";
import type { FilterControlProps } from "./types";

/** Fallback bounds for a spec that declares none. */
const DEFAULT_MIN = 1;
const DEFAULT_MAX = 20;

/**
 * Above this many discrete steps, a slider beats a row of buttons.
 *
 * Eight is where a single row stops fitting a filter popover comfortably; past
 * that the buttons wrap and lose the at-a-glance quality that made them better
 * than a slider in the first place.
 */
const MAX_DISCRETE_STEPS = 8;

export function NumberBoundControl({
  spec,
  value,
  onChange,
  disabled,
}: FilterControlProps<NumberBoundSpec>) {
  const min = spec.min ?? DEFAULT_MIN;
  const max = spec.max ?? DEFAULT_MAX;

  // Defaults to the historical behaviour. A spec whose lowest value is a real
  // answer — "a team of 1" — opts out, or that answer is unreachable.
  const clearAtMin = spec.clearAtMin ?? true;

  const isSet = value !== undefined;

  const steps = max - min + 1;

  const unit = value === 1 && spec.unitOne ? spec.unitOne : spec.unit;

  const readout = isSet ? (
    <>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
      {unit ? ` ${unit}` : ""}
    </>
  ) : (
    "Any"
  );

  const clearButton = isSet ? (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(undefined)}
      className="text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Clear
    </button>
  ) : null;

  if (steps <= MAX_DISCRETE_STEPS) {
    return (
      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-muted-foreground">{readout}</span>
          {clearButton}
        </div>

        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          disabled={disabled}
          // Radix reports an empty string when the pressed item is toggled off,
          // which is the natural "unset this" gesture and is honoured as one.
          value={isSet ? String(value) : ""}
          onValueChange={(next) =>
            onChange(next === "" ? undefined : Number(next))
          }
          className="flex w-full flex-wrap justify-start gap-1.5"
          aria-label={spec.label}
        >
          {Array.from({ length: steps }, (_, index) => min + index).map(
            (step) => (
              <ToggleGroupItem
                key={step}
                value={String(step)}
                aria-label={`${step}${spec.unit ? ` ${spec.unit}` : ""}`}
                className="min-w-9 flex-none rounded-md tabular-nums"
              >
                {step}
                {step === max && spec.openEndedMax ? "+" : ""}
              </ToggleGroupItem>
            ),
          )}
        </ToggleGroup>
      </div>
    );
  }

  // An unset filter parks the handle at the minimum, where it reads as "no
  // restriction" rather than as a value that happens to be selected.
  const current = value ?? min;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-muted-foreground">{readout}</span>
        {clearButton}
      </div>

      <Slider
        value={[current]}
        min={min}
        max={max}
        step={1}
        disabled={disabled}
        aria-label={spec.label}
        onValueChange={([next]) => {
          // Returning the handle to the minimum clears the filter, so the
          // slider can express "no restriction" without a separate control —
          // but only where the minimum is not itself a meaningful answer.
          onChange(clearAtMin && next === min ? undefined : next);
        }}
      />

      <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
        <span>{min}</span>
        <span>
          {max}
          {spec.openEndedMax ? "+" : ""}
        </span>
      </div>
    </div>
  );
}
