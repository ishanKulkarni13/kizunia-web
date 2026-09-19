/**
 * Search Core - Sorting
 *
 * One URL token per sort (`start-date-asc`), not a `sortBy`+`sortOrder`
 * pair — this is Competitions' existing model, promoted to the core in
 * preference to Projects' dynamic-key model, because the set of legal
 * sorts becomes an explicit, reviewable allowlist rather than any column
 * name the caller supplies.
 *
 * A tiebreaker is mandatory and is always appended, so pagination stays
 * deterministic across rows that share a primary sort value (including
 * two `null`s on a nullable column).
 */

export interface SortOption<TOrderBy> {
  readonly key: string;
  readonly label: string;

  /** Primary sort key(s), before the tiebreaker is appended. */
  readonly orderBy: readonly TOrderBy[];
}

export interface SortRegistry<TOrderBy> {
  readonly options: readonly SortOption<TOrderBy>[];
  readonly defaultKey: string;

  /** Appended to every resolved sort unless already present. */
  readonly tiebreaker: TOrderBy;
}

export class InvalidSortRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSortRegistryError";
  }
}

export function defineSortRegistry<TOrderBy>(
  registry: SortRegistry<TOrderBy>,
): SortRegistry<TOrderBy> {
  if (!registry.options.some((option) => option.key === registry.defaultKey)) {
    throw new InvalidSortRegistryError(
      `defaultKey "${registry.defaultKey}" is not one of the registered sort options.`,
    );
  }

  const seen = new Set<string>();

  for (const option of registry.options) {
    if (seen.has(option.key)) {
      throw new InvalidSortRegistryError(
        `Duplicate sort key "${option.key}".`,
      );
    }

    seen.add(option.key);
  }

  return registry;
}

/** The single column name an `orderBy` entry constrains, if it is a simple one. */
function soleKey(orderBy: unknown): string | undefined {
  if (typeof orderBy !== "object" || orderBy === null) {
    return undefined;
  }

  const keys = Object.keys(orderBy);

  return keys.length === 1 ? keys[0] : undefined;
}

/**
 * Resolves a URL sort token to a Prisma `orderBy` array with the
 * tiebreaker appended.
 *
 * An unknown token falls back to the registry default rather than
 * throwing — a saved search or shared URL referencing a since-removed sort
 * must still render results, not an error page.
 */
export function resolveSort<TOrderBy>(
  registry: SortRegistry<TOrderBy>,
  token: string | undefined,
): TOrderBy[] {
  const option =
    registry.options.find((candidate) => candidate.key === token) ??
    registry.options.find((candidate) => candidate.key === registry.defaultKey);

  // `defineSortRegistry` guarantees `defaultKey` exists, so this is
  // unreachable, but keeps the function total for callers constructing a
  // registry by hand without going through the validator.
  if (!option) {
    throw new InvalidSortRegistryError(
      `Sort registry has no option for default key "${registry.defaultKey}".`,
    );
  }

  const tiebreakerKey = soleKey(registry.tiebreaker);

  const alreadyPresent =
    tiebreakerKey !== undefined &&
    option.orderBy.some((entry) => soleKey(entry) === tiebreakerKey);

  return alreadyPresent
    ? [...option.orderBy]
    : [...option.orderBy, registry.tiebreaker];
}

// =============================================================================
// Client-safe projection
// =============================================================================

/**
 * One sort option as the interface sees it.
 *
 * A `SortRegistry` carries the entity's `orderBy` shape, which for a Prisma
 * entity is a Prisma type — so the registry itself must not cross into a
 * client bundle. This is the projection that may: the key that goes in the
 * URL, and the label that goes on the control, and nothing else.
 */
export interface SortOptionSummary {
  readonly key: string;
  readonly label: string;
}

/**
 * Projects a registry into the client-safe summaries a sort control renders.
 *
 * Called on the server and passed down as props, so the option list and the
 * allowlist the server validates against are the same declaration and cannot
 * disagree about which sorts exist.
 */
export function toSortOptionSummaries<TOrderBy>(
  registry: SortRegistry<TOrderBy>,
): readonly SortOptionSummary[] {
  return registry.options.map((option) => ({
    key: option.key,
    label: option.label,
  }));
}
