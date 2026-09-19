/**
 * Slug generation for Technology.
 *
 * There is no shared server-side slug generator elsewhere in the repo to
 * reuse: Competition and Project both require the client to submit an
 * already-formed `slug` alongside `title`/`name` (see
 * `CreateCompetitionSchema`), generating it in the browser. Technology's
 * admin form only collects a `name`, so this module is the one place a slug
 * is derived on the server. Kept deliberately small - ASCII lowercase,
 * hyphen-separated - since technology names in this catalog are
 * overwhelmingly ASCII ("React", "Node.js", "C++"); it is not the
 * Unicode-aware identity normalizer `modules/locations/utils/identity.ts`
 * uses, because that solves a different problem (merge-proof identity keys
 * across providers) that does not apply here.
 */

// Combining diacritical marks (Unicode block U+0300-U+036F) left behind by
// NFKD decomposition - e.g. the acute accent in "e" + U+0301 after
// decomposing an accented "e".
const COMBINING_MARK_PATTERN = /[̀-ͯ]/g;

const NON_SLUG_CHAR_PATTERN = /[^a-z0-9]+/g;

const EDGE_HYPHEN_PATTERN = /^-+|-+$/g;

export function generateTechnologySlug(name: string): string {
    return name
        .normalize("NFKD")
        .replace(COMBINING_MARK_PATTERN, "")
        .toLowerCase()
        .trim()
        .replace(NON_SLUG_CHAR_PATTERN, "-")
        .replace(EDGE_HYPHEN_PATTERN, "");
}
