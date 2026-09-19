/**
 * Search Core - Clause composition
 *
 * Filters are combined as AND-between-groups, OR-within-group. The OR half
 * lives inside each primitive (`in`, or an explicit `OR` array); this module
 * owns the AND half.
 */

/** Structural constraint satisfied by every Prisma where-input. */
export type AndComposable<Self> = {
  AND?: Self | Self[];
};

/**
 * Combines clauses with AND, flattening any clause that is itself a bare
 * `{ AND: [...] }` wrapper.
 *
 * `{ AND: [] }` matches every row, so an empty input is the correct neutral
 * element. (By contrast `{ OR: [] }` and `{ in: [] }` match *nothing* — see
 * `guards.ts`.)
 *
 * This contains the only type assertion in the search core. It is safe
 * because `TWhere extends AndComposable<TWhere>` guarantees `AND` is a
 * valid member and Prisma where-inputs have no required fields. Extend this
 * primitive rather than adding casts elsewhere.
 */
export function composeAnd<TWhere extends AndComposable<TWhere>>(
  clauses: readonly TWhere[],
): TWhere {
  const flattened: TWhere[] = [];

  for (const clause of clauses) {
    const inner = extractSoleAnd(clause);

    if (inner) {
      flattened.push(...inner);
      continue;
    }

    flattened.push(clause);
  }

  return { AND: flattened } as TWhere;
}

/**
 * Returns the inner clauses when `clause` is exactly `{ AND: [...] }` and
 * carries nothing else, so nesting can be collapsed one level.
 */
function extractSoleAnd<TWhere extends AndComposable<TWhere>>(
  clause: TWhere,
): TWhere[] | null {
  const keys = Object.keys(clause as object);

  if (keys.length !== 1 || keys[0] !== "AND") {
    return null;
  }

  const value = clause.AND;

  if (value === undefined) {
    return null;
  }

  return Array.isArray(value) ? value : [value];
}
