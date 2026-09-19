"use client";

/**
 * Search Core (React) - Team size
 *
 * =============================================================================
 * Three questions, one filter
 * =============================================================================
 *
 * "Can I enter with the people I have" is really three separate questions,
 * asked together:
 *
 *   Entry format         how the participant wants to take part — solo, as a
 *                         team, or either — `entryFormat` below.
 *   My team size          the participant's own possible size, when a team is
 *                         on the table at all — `min`/`max` below.
 *   Competition format    what the *competition* itself permits, regardless
 *                         of size — `policy` below.
 *
 * They are independent axes, but not unconditionally so: a solo entrant has
 * no team size to state, and a team entrant can never be satisfied by a
 * strictly-solo competition. Rather than let the interface produce a
 * combination that can only return zero results, each setter here also
 * repairs whatever the change just made contradictory — see `setEntryFormat`,
 * `commitSize`, and the `disabled` conditions on "Solo only" below. The same
 * repairs run again, independently, in `readTeamSize` (`spec-values.ts`) for
 * a URL this control never touched — a shared link or a hand edit gets the
 * same treatment a click would have.
 *
 * `entryFormat` never reaches a Prisma clause — `buildTeamSizeClause` only
 * ever reads `min`, `max` and `policy`. Its entire job is deciding what those
 * two remain allowed to say, not adding a third thing to check. See
 * `TeamEntryFormat` in `../../spec` for the full reasoning.
 */

import { useMemo } from "react";

import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import type {
  TeamEntryFormat,
  TeamSizePolicy,
  TeamSizeSpec,
  TeamSizeValue,
} from "../../spec";
import type { FilterControlProps } from "./types";

const DEFAULT_MIN = 1;
const DEFAULT_MAX = 8;

type SizeMode = "exact" | "range" | "atMost";

const MODE_OPTIONS: readonly { value: SizeMode; label: string }[] = [
  { value: "exact", label: "Exact" },
  { value: "range", label: "Range" },
  { value: "atMost", label: "At most" },
];

const ENTRY_FORMAT_OPTIONS: readonly {
  value: TeamEntryFormat;
  label: string;
}[] = [
  { value: "SOLO", label: "Solo" },
  { value: "TEAM", label: "Team" },
  { value: "EITHER", label: "Either" },
];

/** Which mode a value is currently expressed in, or `null` for no size at all. */
function deriveMode(value: TeamSizeValue | undefined): SizeMode | null {
  if (!value) {
    return null;
  }

  if (value.min !== undefined && value.max !== undefined) {
    return value.min === value.max ? "exact" : "range";
  }

  if (value.max !== undefined) {
    return "atMost";
  }

  return null;
}

/** Drops the value entirely once every field it carries is unset. */
function normalizeOrUndefined(
  value: TeamSizeValue,
): TeamSizeValue | undefined {
  return value.min === undefined &&
    value.max === undefined &&
    value.policy === undefined &&
    value.entryFormat === undefined
    ? undefined
    : value;
}

/**
 * Whether a "Solo only" competition format could still be satisfied by this
 * team-size ceiling. Mirrors the guard in `readTeamSize` exactly, so a
 * selection the control refuses to offer is the same one a stale URL would
 * have been corrected out of.
 */
function conflictsWithSoloOnly(max: number | undefined): boolean {
  return max !== undefined && max > 1;
}

export function TeamSizeControl({
  spec,
  value,
  onChange,
  disabled,
}: FilterControlProps<TeamSizeSpec>) {
  const boundsMin = spec.min ?? DEFAULT_MIN;
  const boundsMax = spec.max ?? DEFAULT_MAX;

  const mode = useMemo(() => deriveMode(value), [value]);

  const entryFormat = value?.entryFormat;
  const isSoloEntry = entryFormat === "SOLO";
  const isTeamEntry = entryFormat === "TEAM";

  const unitFor = (count: number) =>
    count === 1 && spec.unitOne ? spec.unitOne : spec.unit;

  const withUnit = (text: string, count: number) => {
    const suffix = unitFor(count);

    return suffix ? `${text} ${suffix}` : text;
  };

  /** Seeds a sensible starting number when switching into a mode cold. */
  const seedSize = (): number => {
    if (value?.min !== undefined) return value.min;
    if (value?.max !== undefined) return value.max;
    return boundsMin;
  };

  /**
   * The single place `min`/`max` are written. After merging the change, a
   * "Solo only" competition format that the new size has made impossible is
   * dropped — the size is the more specific, more recently stated request,
   * so it is what survives. See `conflictsWithSoloOnly`.
   */
  const commitSize = (partial: Pick<TeamSizeValue, "min" | "max">): void => {
    const merged: TeamSizeValue = { ...value, ...partial };

    const policy =
      merged.policy === "SOLO_ONLY" && conflictsWithSoloOnly(merged.max)
        ? undefined
        : merged.policy;

    onChange(normalizeOrUndefined({ ...merged, policy }));
  };

  const setMode = (next: SizeMode | ""): void => {
    if (next === "") {
      // Radix reports an empty string when the pressed item is toggled off —
      // the natural "no size preference" gesture, honoured as one.
      commitSize({ min: undefined, max: undefined });
      return;
    }

    const seed = seedSize();

    switch (next) {
      case "exact":
        commitSize({ min: seed, max: seed });
        return;

      case "atMost":
        commitSize({ min: undefined, max: seed });
        return;

      case "range": {
        const lo = value?.min ?? seed;

        // A prior `max` is only worth keeping if it already describes a real
        // span above `lo` — Exact and At most both leave `value.max` set to
        // a single number (equal to `lo`, or standing alone), and reusing it
        // as-is would seed a "range" that is really just that same point,
        // leaving the control looking like the button did nothing.
        const priorMax = value?.max;
        const hi =
          priorMax !== undefined && priorMax > lo
            ? priorMax
            : Math.min(boundsMax, lo + 2);

        if (hi === lo) {
          // `lo` is already pinned at the top of the allowed span (e.g. an
          // exact value of `boundsMax`), so there is no room to extend
          // upward — widen downward instead so the range still spans more
          // than one size.
          const adjustedLo = Math.max(boundsMin, lo - 2);

          commitSize({ min: adjustedLo, max: lo });
          return;
        }

        commitSize({ min: lo, max: hi });
        return;
      }
    }
  };

  const setSolo = (): void => {
    commitSize({ min: 1, max: 1 });
  };

  /**
   * Locked while the participant has said Team: "Solo & team" is the only
   * competition format compatible with requiring a team, so there is nothing
   * valid left to toggle to. The "Solo only" item is separately disabled
   * below for the size-conflict case, which can arise under Either too.
   */
  const setPolicy = (next: TeamSizePolicy | ""): void => {
    if (isTeamEntry) {
      return;
    }

    onChange(
      normalizeOrUndefined({
        ...value,
        policy: next === "" ? undefined : next,
      }),
    );
  };

  /**
   * The coordinating switch. Solo clears a team size that no longer applies;
   * Team forces the one competition format compatible with requiring a team.
   * Either imposes nothing by itself — a team-size requirement added *while*
   * Either is active is handled by `commitSize`, not here.
   */
  const setEntryFormat = (next: TeamEntryFormat | ""): void => {
    if (next === "") {
      onChange(normalizeOrUndefined({ ...value, entryFormat: undefined }));
      return;
    }

    let nextValue: TeamSizeValue = { ...value, entryFormat: next };

    if (next === "SOLO") {
      nextValue = { ...nextValue, min: undefined, max: undefined };
    }

    if (next === "TEAM") {
      nextValue = { ...nextValue, policy: "SOLO_OR_TEAM" };
    }

    onChange(normalizeOrUndefined(nextValue));
  };

  const isSolo = value?.min === 1 && value?.max === 1;

  const soloOnlyDisabled =
    disabled || isTeamEntry || conflictsWithSoloOnly(value?.max);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <span className="text-xs font-medium text-muted-foreground">
          Entry format
        </span>

        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          disabled={disabled}
          value={entryFormat ?? ""}
          onValueChange={(next) => setEntryFormat(next as TeamEntryFormat | "")}
          className="flex w-full flex-wrap justify-start gap-1.5"
          aria-label="Entry format"
        >
          {ENTRY_FORMAT_OPTIONS.map((option) => (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              className="flex-none rounded-md"
            >
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <p className="text-xs leading-relaxed text-muted-foreground">
          How do you plan to participate?
        </p>
      </div>

      <Separator />

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            My team size
          </span>

          {/* The one-click path for the single most common answer — going it
              alone — without requiring "Exact" to be picked and then "1".
              Hidden alongside the rest of this section when entry format is
              already Solo, since there is nothing left to shortcut. */}
          {!isSoloEntry && (
            <button
              type="button"
              disabled={disabled}
              onClick={setSolo}
              className={cn(
                "text-xs underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSolo
                  ? "font-medium text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Just me (solo)
            </button>
          )}
        </div>

        {isSoloEntry ? (
          <p className="pt-1 text-sm text-muted-foreground">
            Not applicable — you&rsquo;re entering solo.
          </p>
        ) : (
          <>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              disabled={disabled}
              value={mode ?? ""}
              onValueChange={(next) => setMode(next as SizeMode | "")}
              className="flex w-full flex-wrap justify-start gap-1.5"
              aria-label="Team size mode"
            >
              {MODE_OPTIONS.map((option) => (
                <ToggleGroupItem
                  key={option.value}
                  value={option.value}
                  className="flex-none rounded-md"
                >
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>

            {mode === "exact" && (
              <SizeStepper
                label={withUnit(
                  String(value?.min ?? boundsMin),
                  value?.min ?? boundsMin,
                )}
                value={value?.min ?? boundsMin}
                min={boundsMin}
                max={boundsMax}
                openEndedMax={spec.openEndedMax}
                disabled={disabled}
                onChange={(next) => commitSize({ min: next, max: next })}
              />
            )}

            {mode === "atMost" && (
              <SizeStepper
                label={withUnit(
                  `up to ${value?.max ?? boundsMax}`,
                  value?.max ?? boundsMax,
                )}
                value={value?.max ?? boundsMax}
                min={boundsMin}
                max={boundsMax}
                openEndedMax={false}
                disabled={disabled}
                onChange={(next) => commitSize({ min: undefined, max: next })}
              />
            )}

            {mode === "range" && (
              <div className="space-y-2 pt-1">
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium tabular-nums text-foreground">
                    {value?.min ?? boundsMin}
                  </span>
                  {" – "}
                  <span className="font-medium tabular-nums text-foreground">
                    {value?.max ?? boundsMax}
                    {spec.openEndedMax && (value?.max ?? boundsMax) === boundsMax
                      ? "+"
                      : ""}
                  </span>
                  {spec.unit ? ` ${spec.unit}` : ""}
                </p>

                <Slider
                  value={[value?.min ?? boundsMin, value?.max ?? boundsMax]}
                  min={boundsMin}
                  max={boundsMax}
                  step={1}
                  disabled={disabled}
                  aria-label="Team size range"
                  onValueChange={([lo, hi]) => commitSize({ min: lo, max: hi })}
                />

                <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
                  <span>{boundsMin}</span>
                  <span>
                    {boundsMax}
                    {spec.openEndedMax ? "+" : ""}
                  </span>
                </div>
              </div>
            )}

            {mode === null && (
              <p className="pt-1 text-sm text-muted-foreground">
                Any team size
              </p>
            )}
          </>
        )}
      </div>

      <Separator />

      <div className="space-y-2">
        <span className="text-xs font-medium text-muted-foreground">
          Competition format
        </span>

        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          disabled={disabled}
          value={value?.policy ?? ""}
          onValueChange={(next) => setPolicy(next as TeamSizePolicy | "")}
          className="flex w-full flex-wrap justify-start gap-1.5"
          aria-label="Competition format"
        >
          <ToggleGroupItem
            value="SOLO_ONLY"
            disabled={soloOnlyDisabled}
            className="flex-none rounded-md"
          >
            Solo only
          </ToggleGroupItem>

          <ToggleGroupItem
            value="SOLO_OR_TEAM"
            disabled={disabled || isTeamEntry}
            className="flex-none rounded-md"
          >
            Solo & team
          </ToggleGroupItem>
        </ToggleGroup>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Choose whether the competition must be strictly solo or may also
          allow teams.
        </p>

        {isTeamEntry && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Locked to &ldquo;Solo &amp; team&rdquo; — a strictly-solo
            competition can&rsquo;t be entered as a team.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The single-number picker shared by Exact and At most.
 *
 * Steps stay small by design (`spec.max` defaults to 8) — the same reasoning
 * as `NumberBoundControl`: a small, named set of answers is better shown as
 * buttons than dragged for on a slider.
 */
function SizeStepper({
  label,
  value,
  min,
  max,
  openEndedMax,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  openEndedMax?: boolean;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const steps = max - min + 1;

  return (
    <div className="space-y-2 pt-1">
      <p className="text-sm text-muted-foreground">
        <span className="font-medium tabular-nums text-foreground">{label}</span>
      </p>

      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        disabled={disabled}
        value={String(value)}
        // A stepper always has a value once its mode is chosen, so toggling
        // the active button off would leave the control with nothing to
        // show — re-selecting the same value is a no-op instead of a clear.
        onValueChange={(next) => next !== "" && onChange(Number(next))}
        className="flex w-full flex-wrap justify-start gap-1.5"
        aria-label="Team size value"
      >
        {Array.from({ length: steps }, (_, index) => min + index).map((step) => (
          <ToggleGroupItem
            key={step}
            value={String(step)}
            className="min-w-9 flex-none rounded-md tabular-nums"
          >
            {step}
            {step === max && openEndedMax ? "+" : ""}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
