/**
 * Empty-string -> null normalization for the competition editor.
 *
 * This is deliberately not a blanket rule. Only fields that are genuinely
 * nullable strings in the data contract get normalized; `title` and `slug`
 * stay non-nullable (an empty value there is a real validation error, not
 * "unspecified"), and `content` gets its own, more conservative rule (see
 * `normalizeContentValue`) because it holds markdown, not a short scalar.
 */

/**
 * String fields on `CompetitionEditDTO` that are nullable in
 * `UpdateCompetitionSchema` and hold plain (non-markdown) text. Empty or
 * whitespace-only input in these fields means "unspecified", not a
 * zero-length value worth persisting.
 */
export const NULLABLE_TEXT_FIELDS = [
  "shortDescription",
  "organizer",
  "website",
  "registrationLink",
  "prizePool",
  "registrationFee",
] as const;

export type NullableTextField = (typeof NULLABLE_TEXT_FIELDS)[number];

const NULLABLE_TEXT_FIELD_SET: ReadonlySet<string> = new Set(
  NULLABLE_TEXT_FIELDS,
);

export function isNullableTextField(key: string): key is NullableTextField {
  return NULLABLE_TEXT_FIELD_SET.has(key);
}

/** `"" | "   " -> null`; any other string is returned unchanged. */
export function normalizeTextValue(value: string): string | null {
  return value.trim() === "" ? null : value;
}

/**
 * `content` gets the same "blank means null" rule, but is never treated as
 * one of `NULLABLE_TEXT_FIELDS` because it is markdown, not a short plain
 * string, and clearing it is destructive (it deletes the underlying Content
 * row — see `CompetitionRepository.update`). The editor should reach this
 * only through an explicit "Clear documentation" action, not incidentally
 * via a generic patch normalizer, which is why it lives as its own function
 * rather than being folded into `NULLABLE_TEXT_FIELDS`.
 */
export function normalizeContentValue(value: string): string | null {
  return value.trim() === "" ? null : value;
}

/**
 * Normalizes a partial editor patch before it is merged into store state.
 * Applies `normalizeTextValue` to any key in `NULLABLE_TEXT_FIELDS` whose
 * value is a string; every other key (including `content`, `title`, `slug`,
 * enums, numbers, dates, arrays) passes through untouched.
 *
 * This is the single place empty-string normalization happens — tabs send
 * raw input, and `updateCompetition` calls this before merging, so
 * `competition` in the store always holds canonical values.
 */
export function normalizeEditorPatch<T extends Record<string, unknown>>(
  patch: T,
): T {
  const result: Record<string, unknown> = { ...patch };

  for (const key of Object.keys(result)) {
    if (!isNullableTextField(key)) continue;

    const value = result[key];
    if (typeof value === "string") {
      result[key] = normalizeTextValue(value);
    }
  }

  return result as T;
}
