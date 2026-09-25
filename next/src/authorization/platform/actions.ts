export enum PlatformAction {
  CREATE_COMPETITION = "CREATE_COMPETITION",
  EDIT_COMPETITIONS = "EDIT_COMPETITION",
  VIEW_ALL_COMPETITIONS = "VIEW_ALL_COMPETITIONS",
  // Automatic lifecycle status management: previewing/applying reconciliation
  // and toggling `automaticStatusUpdatesDisabled`. Distinct from
  // EDIT_COMPETITIONS — it governs the automation surface, not ordinary field
  // edits, which stay gated by the existing per-resource CompetitionAction.EDIT.
  MANAGE_COMPETITION_LIFECYCLE = "MANAGE_COMPETITION_LIFECYCLE",
  MANAGE_USERS = "MANAGE_USERS",

  ACCESS_ADMIN_DASHBOARD = "ACCESS_ADMIN_DASHBOARD",

  // Users
  VIEW_ALL_USERS = "VIEW_ALL_USERS",

  // Projects
  VIEW_PUBLIC_PROJECTS = "VIEW_PUBLIC_PROJECTS",
  VIEW_ALL_PROJECTS = "VIEW_ALL_PROJECTS",
  CREATE_PROJECT = "CREATE_PROJECT",

  // Blogs
  VIEW_ALL_BLOGS = "VIEW_ALL_BLOGS",
  CREATE_BLOG = "CREATE_BLOG",

  // Portfolios
  VIEW_ALL_PORTFOLIOS = "VIEW_ALL_PORTFOLIOS",
  CREATE_PORTFOLIO = "CREATE_PORTFOLIO",

  // Suggestions / Moderation
  VIEW_COMPETITION_SUGGESTIONS = "VIEW_COMPETITION_SUGGESTIONS",
  CREATE_COMPETITION_SUGGESTION = "CREATE_COMPETITION_SUGGESTION",
  REVIEW_COMPETITION_SUGGESTIONS = "REVIEW_COMPETITION_SUGGESTIONS",

  VIEW_PROJECT_SUGGESTIONS = "VIEW_PROJECT_SUGGESTIONS",
  REVIEW_PROJECT_SUGGESTIONS = "REVIEW_PROJECT_SUGGESTIONS",

  VIEW_BLOG_SUGGESTIONS = "VIEW_BLOG_SUGGESTIONS",
  REVIEW_BLOG_SUGGESTIONS = "REVIEW_BLOG_SUGGESTIONS",

  // Taxonomy
  MANAGE_CATEGORIES = "MANAGE_CATEGORIES",
  MANAGE_TECHNOLOGIES = "MANAGE_TECHNOLOGIES",
  MANAGE_TAGS = "MANAGE_TAGS",

  // Assets
  MANAGE_MEDIA = "MANAGE_MEDIA",

  // Notifications
  // Authoring and scheduling platform announcements. The only write in the
  // system whose blast radius is every user, so it is its own permission rather
  // than riding on ACCESS_ADMIN_DASHBOARD.
  MANAGE_NOTIFICATION_ANNOUNCEMENTS = "MANAGE_NOTIFICATION_ANNOUNCEMENTS",

  // Subscription & Billing (role assignment: IB-15, docs/architecture/subscription/implementation/open-decisions.md)
  // Creating, extending or revoking an entitlement grant. A grant is
  // money-equivalent — it gives paid access for free — so it is its own
  // permission, held only by SUPER_ADMIN.
  MANAGE_ENTITLEMENT_GRANTS = "MANAGE_ENTITLEMENT_GRANTS",
  // Reading billing state: grants, and later subscriptions, history and
  // anomalies. Never a write.
  VIEW_BILLING = "VIEW_BILLING",
  // Billing writes other than grants (admin immediate cancel, anomaly
  // resolution, bulk re-sync). Assigned now; first used in a later phase.
  MANAGE_BILLING = "MANAGE_BILLING",

  // Site
  MANAGE_SITE_SETTINGS = "MANAGE_SITE_SETTINGS",
  VIEW_AUDIT_LOGS = "VIEW_AUDIT_LOGS",
}
