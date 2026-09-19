/**
 * Taxonomy - Option DTO
 *
 * The shape a filter control binds to, and deliberately nothing more.
 *
 * A `Category` row carries an id and a name; a `Technology` row also carries
 * an icon url and a description. None of that belongs in a filter option: the
 * search matches on `slug`, and shipping fields the control cannot use would
 * grow every listing payload for no benefit.
 *
 * `slug` is the value because that is what the URL carries and what the query
 * matches. Using ids would produce shorter but unreadable links, and would
 * break every saved search the moment a row were re-created.
 */
export interface TaxonomyOptionDTO {
  /** The slug, as it appears in the URL and in the query. */
  readonly value: string;

  /** Human-readable name. */
  readonly label: string;

  /**
   * How many publicly visible rows of the requested entity
   * (`TaxonomyQuery.entity` — competitions or projects) carry this option.
   *
   * Present so the interface can show a count beside each option and hide
   * ones that would return nothing. Counted against the same visibility
   * rules that entity's public search applies, so an option that shows "12"
   * cannot return zero results.
   */
  readonly count: number;
}
