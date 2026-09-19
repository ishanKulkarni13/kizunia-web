/**
 * Search Core - Multi-value filter primitives
 *
 * All of these produce OR-within-group semantics via Prisma `in`, and are
 * AND-composed with other filters by the engine.
 *
 * None of them decode anything. Decoding belongs to `readFilterValue`, which
 * already guarantees a non-empty, spec-valid list — so no factory here has to
 * defend against the empty `in` that would match zero rows.
 */

import type {
  EnumMultiSpec,
  RelationMultiSpec,
} from "../spec";
import type { FilterDescriptor } from "../types";

// =============================================================================
// Enum coverage
// =============================================================================

export class EnumSpecCoverageError extends Error {
  constructor(key: string, missing: readonly string[], extra: readonly string[]) {
    const parts = [
      missing.length > 0 ? `missing option(s): ${missing.join(", ")}` : "",
      extra.length > 0 ? `unknown option(s): ${extra.join(", ")}` : "",
    ].filter(Boolean);

    super(
      `Filter "${key}" declares enum options that do not match the database enum — ${parts.join("; ")}.`,
    );

    this.name = "EnumSpecCoverageError";
  }
}

/**
 * Asserts that a spec's declared options are exactly the database enum.
 *
 * This is the safety net that makes it acceptable for `spec.ts` to list enum
 * values as plain strings rather than importing the Prisma enum. A member
 * added to the schema and forgotten in the spec would otherwise simply never
 * appear in the UI — a silent, easily-missed omission. Here it is a
 * module-load failure, so it surfaces the first time the app starts rather
 * than the first time a user looks for the missing option.
 *
 * Extra options are rejected for the mirror-image reason: an option the
 * database no longer has would render a control that can only ever return
 * nothing.
 */
export function assertEnumSpecCoverage<TEnum extends string>(
  spec: EnumMultiSpec<TEnum>,
  values: readonly TEnum[],
): void {
  const declared = new Set<string>(spec.options.map((option) => option.value));
  const actual = new Set<string>(values);

  const missing = [...actual].filter((value) => !declared.has(value));
  const extra = [...declared].filter((value) => !actual.has(value));

  if (missing.length > 0 || extra.length > 0) {
    throw new EnumSpecCoverageError(spec.key, missing, extra);
  }
}

// =============================================================================
// Factories
// =============================================================================

/**
 * Multi-select over a scalar enum column.
 *
 * @example
 * enumMultiFilter<Prisma.CompetitionWhereInput, CompetitionMode>({
 *   spec: competitionFilterSpecs.modes,
 *   values: Object.values(CompetitionMode),
 *   toWhere: (modes) => ({ mode: { in: modes } }),
 * })
 */
export function enumMultiFilter<TWhere, TEnum extends string>(config: {
  spec: EnumMultiSpec<TEnum>;

  /** The database enum, for the coverage assertion above. */
  values: readonly TEnum[];

  toWhere: (values: TEnum[]) => TWhere;
}): FilterDescriptor<TWhere, EnumMultiSpec<TEnum>> {
  assertEnumSpecCoverage(config.spec, config.values);

  const allowed = new Set<string>(config.values);

  return {
    spec: config.spec,

    toWhere: (decoded) => {
      // A type refinement, not a filter. `readFilterValue` has already
      // dropped anything outside `spec.options`, and the assertion above
      // proves `spec.options` and `values` describe the same set — so this
      // narrowing provably removes nothing and cannot produce an empty `in`.
      const narrowed = decoded.filter((value): value is TEnum =>
        allowed.has(value),
      );

      return config.toWhere(narrowed);
    },
  };
}

/**
 * Multi-select matching a related row by enum value, e.g. eligibility types
 * stored as rows rather than as a scalar column.
 *
 * Decoding and presentation are identical to `enumMultiFilter`; only the
 * clause shape differs, and that is the caller's `toWhere`. Kept as a
 * separate named export so the distinction is greppable at declaration sites.
 */
export function enumRelationMultiFilter<TWhere, TEnum extends string>(config: {
  spec: EnumMultiSpec<TEnum>;
  values: readonly TEnum[];
  toWhere: (values: TEnum[]) => TWhere;
}): FilterDescriptor<TWhere, EnumMultiSpec<TEnum>> {
  return enumMultiFilter(config);
}

/**
 * Multi-select matching a related row by slug or id — categories,
 * technologies, authors.
 *
 * Values are not validated against an option list. Taxonomies are open sets
 * loaded separately from the page, and a slug the current page did not happen
 * to load options for is still a legitimate filter the database can answer.
 */
export function relationMultiFilter<TWhere>(config: {
  spec: RelationMultiSpec;
  toWhere: (values: string[]) => TWhere;
}): FilterDescriptor<TWhere, RelationMultiSpec> {
  return {
    spec: config.spec,

    toWhere: (values) => config.toWhere([...values]),
  };
}
