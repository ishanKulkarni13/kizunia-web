"use client";

/**
 * Search Core (React) - Control dispatch
 *
 * =============================================================================
 * The property this file exists to guarantee
 * =============================================================================
 *
 * Adding a filter must never mean editing filter UI.
 *
 * Every panel, drawer and quick bar renders `<FilterControl />` and passes it a
 * spec. This is the only place that knows which component a kind maps to, so a
 * new filter of an existing kind is purely a spec addition — nothing here, and
 * nothing in any composing component, changes.
 *
 * A genuinely new *kind* is the only case that touches this file, and then it
 * touches exactly three places: one branch here, one control component, and
 * one branch each in `readFilterValue` / `writeFilterValue`. That is the full
 * cost of extending the vocabulary, and it is bounded by design.
 *
 * =============================================================================
 * Why a switch and not a lookup table
 * =============================================================================
 *
 * A `Record<FilterKind, Component>` cannot preserve the correlation between a
 * spec's kind and its value type — every entry would be typed against the
 * union, and each control would need a cast to recover the value it actually
 * receives.
 *
 * A switch narrows both together. Inside each branch TypeScript knows the spec
 * is (say) `EnumMultiSpec` and therefore that its value is `readonly string[]`,
 * so the props type-check with no assertion anywhere. Exhaustiveness is
 * enforced by the `never` in the default branch: a new kind fails to compile
 * until it is handled.
 */

import type { FilterSpec, ValueOfSpec } from "../../spec";
import type { FilterOption } from "../../spec";
import { BooleanControl } from "./boolean-control";
import { DateRangeControl } from "./date-range-control";
import { EnumMultiControl } from "./enum-multi-control";
import { NumberBoundControl } from "./number-bound-control";
import { PlaceControl } from "./place-control";
import { RelationMultiControl } from "./relation-multi-control";
import { TeamSizeControl } from "./team-size-control";
import { TextAnyControl, TextControl } from "./text-control";

export interface FilterControlDispatchProps {
  readonly spec: FilterSpec;

  /**
   * The decoded value, read by the caller.
   *
   * Typed loosely at the dispatch boundary and narrowed inside each branch —
   * the caller holds a heterogeneous list of specs and cannot know which value
   * type any given one has until the kind is examined.
   */
  readonly value: ValueOfSpec<FilterSpec> | undefined;

  readonly onChange: (value: ValueOfSpec<FilterSpec> | undefined) => void;

  readonly options?: readonly FilterOption[];

  readonly counts?: Readonly<Record<string, number>>;

  readonly disabled?: boolean;
}

export function FilterControl({
  spec,
  value,
  onChange,
  options,
  counts,
  disabled,
}: FilterControlDispatchProps) {
  // Each branch narrows `spec`, which fixes the value type through
  // `FilterValueOf` — so these casts assert nothing the compiler could not
  // verify given a correlated union, and they are confined to this one
  // function so no control or panel needs one.
  switch (spec.kind) {
    case "enum-multi":
      return (
        <EnumMultiControl
          spec={spec}
          value={value as readonly string[] | undefined}
          onChange={onChange}
          counts={counts}
          disabled={disabled}
        />
      );

    case "relation-multi":
      return (
        <RelationMultiControl
          spec={spec}
          value={value as readonly string[] | undefined}
          onChange={onChange}
          options={options}
          counts={counts}
          disabled={disabled}
        />
      );

    case "text":
      return (
        <TextControl
          spec={spec}
          value={value as string | undefined}
          onChange={onChange}
          disabled={disabled}
        />
      );

    case "text-any":
      return (
        <TextAnyControl
          spec={spec}
          value={value as readonly string[] | undefined}
          onChange={onChange}
          disabled={disabled}
        />
      );

    case "number-bound":
      return (
        <NumberBoundControl
          spec={spec}
          value={value as number | undefined}
          onChange={onChange}
          disabled={disabled}
        />
      );

    case "date-range":
      return (
        <DateRangeControl
          spec={spec}
          value={value as never}
          onChange={onChange}
          disabled={disabled}
        />
      );

    case "boolean":
      return (
        <BooleanControl
          spec={spec}
          value={value as true | undefined}
          onChange={onChange}
          disabled={disabled}
        />
      );

    case "place":
      return (
        <PlaceControl
          spec={spec}
          value={value as never}
          onChange={onChange}
          disabled={disabled}
        />
      );

    case "team-size":
      return (
        <TeamSizeControl
          spec={spec}
          value={value as never}
          onChange={onChange}
          disabled={disabled}
        />
      );

    default: {
      // Unreachable while every kind is handled. If a kind is added to
      // `FilterKind` and not to this switch, `spec` is no longer `never` here
      // and the assignment fails to compile — which is the point.
      const exhaustive: never = spec;

      return exhaustive;
    }
  }
}

export { BooleanControl } from "./boolean-control";
export { DateRangeControl } from "./date-range-control";
export { EnumMultiControl } from "./enum-multi-control";
export { NumberBoundControl } from "./number-bound-control";
export { PlaceControl } from "./place-control";
export { RelationMultiControl } from "./relation-multi-control";
export { TeamSizeControl } from "./team-size-control";
export { TextAnyControl, TextControl } from "./text-control";
export type { FilterControlProps } from "./types";
