/**
 * A search area as offered in the competition location filter.
 *
 * `contextLabel` and `providerKind` are not decoration: once "Nashik City" and
 * "Nashik District" both exist, a bare display name gives the user no way to
 * pick the entity they meant, and picking the wrong one silently changes which
 * competitions they see.
 */
export interface SearchAreaDTO {
  id: string;

  displayName: string;

  /** Provider's own type string, e.g. "locality". Display only. */
  providerKind: string | null;

  /** Parent context, e.g. "Maharashtra, India". */
  contextLabel: string | null;
}
