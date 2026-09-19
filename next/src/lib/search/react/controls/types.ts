"use client";

/**
 * Search Core (React) - Control contract
 *
 * =============================================================================
 * Controls are controlled, and know nothing about URLs
 * =============================================================================
 *
 * Every control receives a value and emits a new one. None of them reads the
 * address bar, calls the router, or knows whether its change will be applied
 * immediately or held behind an Apply button.
 *
 * That is what lets one implementation serve both modes. The quick bar wires
 * `onChange` straight to `apply` and navigates; the advanced panel wires the
 * same `onChange` to `stage` and holds it. Neither the control nor its author
 * has to think about which.
 *
 * It is also what keeps them reusable across entities. A control is a function
 * of a spec and a value, and specs are entity-agnostic — so Competitions,
 * Projects and Blogs share these components without adaptation.
 */

import type { FilterOption, FilterSpec, ValueOfSpec } from "../../spec";

export interface FilterControlProps<TSpec extends FilterSpec> {
  readonly spec: TSpec;

  /** `undefined` means the filter is not set. */
  readonly value: ValueOfSpec<TSpec> | undefined;

  /** Emitting `undefined` clears the filter. */
  readonly onChange: (value: ValueOfSpec<TSpec> | undefined) => void;

  /**
   * Options for kinds whose values come from the database.
   *
   * Passed in rather than fetched by the control, so a Server Component can
   * resolve them during render and the picker is populated on first paint.
   * A control that fetched its own options would flash empty on every mount
   * and would make the list impossible to server-render.
   */
  readonly options?: readonly FilterOption[];

  /** Per-option result counts, keyed by option value. */
  readonly counts?: Readonly<Record<string, number>>;

  readonly disabled?: boolean;

  /**
   * Compact presentation for the quick bar, where a control lives inside a
   * popover trigger rather than a labelled panel section.
   */
  readonly compact?: boolean;
}
