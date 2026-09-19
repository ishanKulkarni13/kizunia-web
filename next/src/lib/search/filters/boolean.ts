/**
 * Search Core - Boolean filter primitive
 *
 * For flags such as "has certificate" or "is featured".
 *
 * Only `true` is meaningful as a query parameter: absence and "false" both
 * mean "not filtered". A boolean filter narrows results when set; it does not
 * let a caller explicitly request `false`. No current column needs that, and
 * supporting it would double the parameter's states — and give one view two
 * URLs — for no use case.
 */

import type { BooleanSpec } from "../spec";
import type { FilterDescriptor } from "../types";

export function booleanFilter<TWhere>(config: {
  spec: BooleanSpec;
  toWhere: (value: true) => TWhere;
}): FilterDescriptor<TWhere, BooleanSpec> {
  return {
    spec: config.spec,

    toWhere: config.toWhere,
  };
}
