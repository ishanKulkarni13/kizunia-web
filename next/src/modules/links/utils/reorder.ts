/**
 * Whether `providedIds` names every id in `ownedIds` exactly once — no
 * duplicates, no missing ids, no foreign ids.
 *
 * Domain-agnostic: callers own the error raised when this is false.
 */
export function isExactCover(
  ownedIds: string[],
  providedIds: string[],
): boolean {
  const ownedSet = new Set(ownedIds);

  const providedSet = new Set(providedIds);

  return (
    providedSet.size === providedIds.length &&
    providedSet.size === ownedSet.size &&
    providedIds.every((id) => ownedSet.has(id))
  );
}
