/**
 * Field status derivation for the competition editor.
 *
 * These are administrative states describing the *editor's* relationship to
 * a field's value, not the value's product meaning and not a validation
 * result. They are derived purely from comparing the current editor value
 * to the last-persisted value — no separate flags are stored anywhere.
 */
export type FieldStatus = "NULL" | "UNSAVED" | "DONE";

/** An id-bearing item, e.g. `CompetitionTechnologyDTO` / `CompetitionLocationDTO`. */
interface Identified {
  id: unknown;
}

function hasId(value: unknown): value is Identified {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in (value as Record<string, unknown>)
  );
}

/**
 * True for a value that represents "intentionally absent": `null`,
 * `undefined`, an empty/whitespace-only string, or an empty array.
 * `0` and `false` are not blank — they are meaningful values.
 */
export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Value equality for editor comparisons. Primitives compare with
 * `Object.is`. Arrays of id-bearing items (technologies, locations) compare
 * as sets of ids, order-independent, matching how those fields are actually
 * persisted (attach/detach, not an ordered replace) — except locations,
 * which do have an `order`, but reordering happens through its own endpoint
 * and is reflected into `original` immediately (see `setLocations`), so it
 * never appears as a pending diff here.
 */
export function isEquivalent(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;

    const idsOf = (arr: unknown[]) =>
      new Set(arr.map((item) => (hasId(item) ? item.id : item)));

    const setA = idsOf(a);
    const setB = idsOf(b);

    if (setA.size !== setB.size) return false;

    for (const id of setA) {
      if (!setB.has(id)) return false;
    }

    return true;
  }

  // Single id-bearing objects (logoAsset/bannerAsset/coverAsset): `original`
  // is a `structuredClone` of `competition` (see `initialize` in the
  // store), so nested objects never share a reference even when their
  // content is identical. Comparing by id — the same rule the array branch
  // above already applies — avoids a permanent phantom UNSAVED status for
  // every asset field from the moment the editor loads.
  if (hasId(a) || hasId(b)) {
    if (!hasId(a) || !hasId(b)) return false;
    return a.id === b.id;
  }

  return Object.is(a, b);
}

/**
 * Derives NULL / UNSAVED / DONE for one field.
 *
 * - `current` differs from `saved` -> UNSAVED, regardless of either value.
 * - Otherwise, `saved` is blank -> NULL; populated -> DONE.
 *
 * This intentionally does not special-case "cleared but unsaved": comparing
 * `current` to `saved` and taking the equality branch first is what makes
 * "cleared, not yet saved" resolve to UNSAVED (values differ) rather than
 * NULL (which only applies to the persisted, agreed-upon state).
 */
export function deriveFieldStatus(
  current: unknown,
  saved: unknown,
): FieldStatus {
  if (!isEquivalent(current, saved)) return "UNSAVED";
  return isBlank(saved) ? "NULL" : "DONE";
}
