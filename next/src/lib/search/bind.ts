/**
 * Search Core - Value-type erasure
 *
 * A registry holds filters whose decoded values have different types
 * (`string[]`, date ranges, numbers). Typing that collection as
 * `FilterDescriptor<TWhere, any>[]` would surrender type safety exactly
 * where it matters.
 *
 * `bindFilter` instead captures the value type inside a closure and returns a
 * `BoundFilter<TWhere>` that no longer mentions it — the standard encoding of
 * an existential type in TypeScript. All checking still happens at the
 * declaration site, where `toWhere` is verified against both the spec's value
 * type and the entity's real Prisma where-input.
 */

import { filterParams, type FilterSpec } from "./spec";
import { readFilterValue } from "./spec-values";
import type {
  BoundFilter,
  FilterDescriptor,
  RawSearchParams,
} from "./types";

/**
 * Narrows the full parameter bag to only the keys a filter owns, so a filter
 * cannot read — or accidentally come to depend on — anything else.
 *
 * With decoding now centralised this is defence in depth rather than the
 * mechanism itself, but it is cheap and it keeps the ownership rule true at
 * runtime as well as on paper.
 */
function ownedParams(
  params: RawSearchParams,
  keys: readonly string[],
): RawSearchParams {
  const owned: RawSearchParams = {};

  for (const key of keys) {
    owned[key] = params[key];
  }

  return owned;
}

export function bindFilter<TWhere, TSpec extends FilterSpec>(
  descriptor: FilterDescriptor<TWhere, TSpec>,
): BoundFilter<TWhere> {
  const { spec } = descriptor;

  const params = filterParams(spec);

  return {
    spec,

    key: spec.key,

    params,

    toWhereFromParams: (raw) => {
      const value = readFilterValue(spec, ownedParams(raw, params));

      // `undefined` means absent, empty or unusable. Guarding here is what
      // keeps `{ in: [] }` and `{ OR: [] }` — which match zero rows in
      // Prisma — from ever being constructed.
      if (value === undefined) {
        return undefined;
      }

      return descriptor.toWhere(value);
    },
  };
}
