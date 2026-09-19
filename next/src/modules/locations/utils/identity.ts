import { LocationProvider } from "@/generated/prisma";

/**
 * Locations - Persistent geographic identity
 *
 * =============================================================================
 * What an identity key is for
 * =============================================================================
 *
 * An identity key is the join between two independently-derived views of the
 * same real-world place: the one ingestion writes when an admin attaches a
 * location, and the one search derives when a visitor selects a place from the
 * provider. They are built from two *different* provider responses and matched
 * on exact string equality, so every rule here has to be deterministic and
 * stable over time.
 *
 * That makes this a persistence concern, not a formatting one. A display slug
 * may be lossy, may change when the copy changes, and may be regenerated at
 * will. An identity key may do none of those things: changing how it is built
 * orphans every row already written under the old rules, which is why
 * `EXTRACTION_VERSION` exists and why it has to be bumped whenever this file's
 * behaviour changes.
 */

/**
 * Folds diacritics onto their base letter — **for Latin script only**.
 *
 * The restriction is the entire point. Applied to combining marks generally,
 * this would strip Devanagari vowel signs and viramas, Arabic harakat and
 * Hebrew niqqud, changing what a name *says* rather than merely how it is
 * decorated: the vowel sign in "पुणे" is a non-spacing mark, and removing it
 * yields a different word. Latin marks are decorative in exactly the way an
 * accent fold assumes, and no other script's reliably are, so the base
 * character is checked before anything is removed.
 *
 * Runs against NFD input, where a precomposed "e-acute" has already been
 * decomposed into "e" plus a combining acute.
 */
const LATIN_DIACRITIC_PATTERN = /(\p{Script=Latin})\p{Mn}+/gu;

/**
 * Anything that is not a Unicode letter, number, or combining mark.
 *
 * Collapsed to a single hyphen rather than enumerated as a separator list:
 * every script punctuates differently, and an allowlist of separators is one
 * more place for a locale to be forgotten. Runs of separators collapse
 * together, so spacing differences between provider responses cannot fork a
 * place.
 *
 * Marks are *kept*, and that is load-bearing. A Devanagari vowel sign is a
 * mark rather than a letter, so excluding marks here would delete it — the
 * same corruption `LATIN_DIACRITIC_PATTERN` is careful to avoid, reintroduced
 * one step later. Latin diacritics have already been folded away by then, so
 * every mark still standing at this point belongs to a script where it carries
 * meaning.
 */
const NON_IDENTITY_PATTERN = /[^\p{L}\p{N}\p{M}]+/gu;

/** Leading and trailing separators left behind by the collapse above. */
const EDGE_HYPHEN_PATTERN = /^-+|-+$/gu;

/**
 * Collapses a place name to a stable comparison form.
 *
 * =============================================================================
 * Why this is not a slugify
 * =============================================================================
 *
 * The obvious implementation — lowercase, strip to `[a-z0-9]`, join with
 * hyphens — is what this replaced, and it had a defect that only appears
 * outside Latin scripts: every character is stripped, the name normalizes to
 * the empty string, and the key becomes `component:locality::japan`. Two
 * different cities in one prefecture then produce byte-identical keys and
 * *merge*. A merge is the one failure this system is otherwise structurally
 * incapable of, so an ASCII-only normalizer quietly reintroduces the exact
 * class of bug the identity design exists to prevent.
 *
 * The rules below are therefore Unicode-aware by necessity, not by polish:
 *
 *   1. NFD, then fold Latin-only diacritics, so a precomposed and a decomposed
 *      spelling of the same Latin name converge on one key.
 *   2. NFC, so two encodings of the same Devanagari or Hangul syllable produce
 *      identical bytes. Without this, provider responses differing only in
 *      normalization form would fork a place.
 *   3. `toLowerCase()`, which is locale-independent by specification — unlike
 *      `toLocaleLowerCase()`, which would make a persistent identity depend on
 *      the server's locale (Turkish dotless-i being the classic example).
 *   4. Runs of non-letter, non-number characters collapse to a single hyphen.
 *
 * The result is lossy and is only ever used for identity. Display names are
 * stored verbatim, always.
 *
 * Returns `null` when nothing survives. An empty segment is never emitted,
 * because an empty segment is precisely what lets two different places
 * collide. Callers must treat `null` as "this name cannot carry an identity"
 * and fall back to a stronger key rather than building a weak one.
 */
export function normalizeIdentityName(value: string): string | null {
  const normalized = value
    .normalize("NFD")
    .replace(LATIN_DIACRITIC_PATTERN, "$1")
    .normalize("NFC")
    .toLowerCase()
    .replace(NON_IDENTITY_PATTERN, "-")
    .replace(EDGE_HYPHEN_PATTERN, "");

  return normalized.length > 0 ? normalized : null;
}

/**
 * Identity for an entity the provider gave a stable id for.
 *
 * This is the strong case, and the reason it is always preferred: Nashik City
 * and Nashik District carry different provider ids, so they separate here
 * without Kizunia having to understand what a district is. It also cannot be
 * affected by localization, which is why it is the fallback whenever a
 * component identity cannot be built safely.
 */
export function providerIdentityKey(
  provider: LocationProvider,
  providerPlaceId: string,
): string {
  return `${provider.toLowerCase()}:place:${providerPlaceId}`;
}

/**
 * Identity for an entity known only from an address component.
 *
 * The provider's raw type is part of the key, not decoration. Without it,
 * `administrative_area_level_2 = "Nashik"` and `locality = "Nashik"` — a
 * district and a city with different boundaries — would collapse into one
 * SearchArea, and a competition in Yeola would start appearing under Nashik
 * City.
 *
 * The parent context keeps same-named places in different regions apart: there
 * are many places called "Indira Nagar".
 *
 * Returns `null` when the subject's own name cannot be normalized, or when any
 * context part cannot be. Refusing is the whole point: a key with a missing
 * segment is not a weaker key, it is a *different* key that some other place
 * may also produce. The caller falls back to provider identity, which is
 * narrower but never wrong.
 */
export function contextualIdentityKey(params: {
  name: string;
  providerKind: string | null;
  parentContext: readonly string[];
}): string | null {
  const name = normalizeIdentityName(params.name);

  if (name === null) {
    return null;
  }

  // An unknown kind is still deterministic, so it is allowed — unlike an
  // unknown *name*, which would make the key ambiguous rather than merely
  // coarse. Provider type strings are ASCII identifiers, so the fallback here
  // is defensive rather than expected.
  const kind = params.providerKind
    ? (normalizeIdentityName(params.providerKind) ?? "unknown")
    : "unknown";

  const context: string[] = [];

  for (const part of params.parentContext) {
    const normalized = normalizeIdentityName(part);

    // A context part that normalizes to nothing would silently shorten the
    // chain, and a shorter chain names a different, broader entity. Refuse the
    // whole key rather than emit one that means something else.
    if (normalized === null) {
      return null;
    }

    context.push(normalized);
  }

  return ["component", kind, name, ...context].join(":");
}

/**
 * Human-readable parent context for pickers, e.g. "Maharashtra, India".
 *
 * Required, not cosmetic: once "Nashik City" and "Nashik District" both exist,
 * a bare display name gives the user no way to pick the one they meant.
 *
 * Display only — never an input to identity, which is why it keeps the
 * provider's original casing and script.
 */
export function buildContextLabel(
  parentContext: readonly (string | null | undefined)[],
): string | null {
  const parts = parentContext
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(", ") : null;
}
