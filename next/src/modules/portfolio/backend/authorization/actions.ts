export enum PortfolioAction {
  VIEW = "VIEW",

  CREATE = "CREATE",

  EDIT = "EDIT",

  DELETE = "DELETE",

  /**
   * Manage the Portfolio's relationships to Projects (attach, detach,
   * feature, reorder). Owner-only, like EDIT — kept as its own action so the
   * two can diverge later without touching call sites.
   *
   * This authorizes the *Portfolio* side only. Eligibility to attach a
   * particular Project is a separate membership check in the service; no
   * ProjectAction is involved, since CONTRIBUTOR holds only ProjectAction.VIEW
   * yet must still be able to showcase a project they participate in.
   */
  MANAGE_PROJECTS = "MANAGE_PROJECTS",

  /**
   * Manage the Portfolio's own Testimonials (create, update, delete,
   * reorder). Owner-only, like EDIT — kept as its own action so the two can
   * diverge later without touching call sites.
   *
   * Image management is part of testimonial management: there is no
   * separate action for attaching/replacing/removing a testimonial's image.
   * A Testimonial is Portfolio-owned content, not a reference to another
   * domain's source-of-truth entity, so unlike MANAGE_PROJECTS this needs
   * no separate cross-domain eligibility check.
   */
  MANAGE_TESTIMONIALS = "MANAGE_TESTIMONIALS",

  /**
   * Manage the Portfolio's relationships to Technologies (add, remove,
   * reorder, edit relationship metadata such as startedUsingAt/description).
   * Owner-only, like EDIT — kept as its own action so it can diverge later
   * without touching call sites.
   *
   * This authorizes the *Portfolio* side only. It never grants authority
   * over the global Technology catalog, which is gated separately by
   * PlatformAction.MANAGE_TECHNOLOGIES.
   */
  MANAGE_TECHNOLOGIES = "MANAGE_TECHNOLOGIES",
}