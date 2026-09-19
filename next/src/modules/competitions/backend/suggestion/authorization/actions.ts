export enum CompetitionSuggestionAction {
  VIEW = "VIEW",
  CREATE = "CREATE",
  UPDATE = "UPDATE",
  SUBMIT = "SUBMIT",
  DELETE = "DELETE",

  /** Admin read of any suggestion, regardless of ownership. */
  VIEW_ANY = "VIEW_ANY",

  /** The three moderation decisions (approve / reject / request changes) —
   * one action, since all three share the same precondition and permission;
   * which transition happens is a service-method concern, not an
   * authorization concern. */
  REVIEW = "REVIEW",

  /** Admin removal of a suggestion's attached asset. Deliberately has no
   * status precondition — admins may clean up assets at any time. */
  MODERATE_ASSETS = "MODERATE_ASSETS",

  /** Contributor transition of their own CHANGES_REQUESTED suggestion back
   * to DRAFT so it becomes editable again. */
  REOPEN = "REOPEN",
}
