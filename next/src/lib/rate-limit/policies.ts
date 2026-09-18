/**
 * Rate Limit Policy Registry — the only place a limit number appears.
 *
 * A controller or service declares "this operation is subject to policy X"
 * by importing a `RateLimitPolicyId`; it never sees a number. Changing a
 * limit is a one-line edit here, not a change to domain code, and the
 * registry is the canonical answer to "what are all the limits on this
 * platform?"
 *
 * No plan names appear here, on purpose. This registry expresses V1
 * defaults only. Plan-specific and organization-specific values are a
 * FUTURE override layer the resolver (see resolver.ts) will consult ahead
 * of these defaults — the registry itself never grows an `if (plan ===
 * "PRO")` branch.
 */

export const RateLimitPolicyId = {
  TAXONOMY_CATEGORIES: "taxonomy:categories",
  TAXONOMY_TECHNOLOGIES: "taxonomy:technologies",
  PLACES_AUTOCOMPLETE: "places:autocomplete",
  /**
   * Not a per-caller rate limit — a platform-wide provider spend budget.
   * Kept in the same registry because it is resolved and enforced through
   * the same service, but it uses the `global` subject strategy and fails
   * closed: see the module docstring on `subjectStrategy` below.
   */
  PLACES_RESOLVE: "places:resolve",
  ASSETS_UPLOAD_INTENT: "assets:upload-intent",
  ASSETS_FINALIZE: "assets:finalize",
  COMPETITIONS_SEARCH: "competitions:search",
  /**
   * Bookmark and mark-as-registered toggles share one bucket — the two
   * features are independent in the domain but identical in cost, and one
   * bucket is the honest way to bound one person's total toggling.
   */
  COMPETITIONS_USER_STATE_WRITE: "competitions:user-state-write",
  /**
   * The batch "which of these competitions have I saved/registered for"
   * read that the list and detail pages each issue once per page load.
   */
  COMPETITIONS_USER_STATE_READ: "competitions:user-state-read",
  PORTFOLIO_READ_PUBLIC: "portfolio:read-public",
  AUTH_SIGN_IN: "auth:sign-in",
  AUTH_SIGN_UP: "auth:sign-up",
  AUTH_PASSWORD_RESET_REQUEST: "auth:password-reset-request",
  /**
   * Phase 0's manual/internal recommendation-generation testing route. Not a
   * spend concern (one local DB read plus in-memory scoring), but a full
   * pipeline run per request is real CPU work, so it is still bounded.
   */
  RECOMMENDATIONS_GENERATE: "recommendations:generate",
  /**
   * Notification-preference read/write for the current user. Same
   * subject/failure-mode profile as `COMPETITIONS_USER_STATE_READ/WRITE`:
   * local DB only, no spend, guards against a stuck retry loop rather than
   * cost.
   */
  NOTIFICATION_PREFERENCES_READ: "notification-preferences:read",
  NOTIFICATION_PREFERENCES_WRITE: "notification-preferences:write",
  /**
   * Competition-preference read/write for the current user. The write path
   * validates against category/technology/search-area tables, so it is a
   * little heavier than a bare upsert, but still local DB only.
   */
  COMPETITION_PREFERENCES_READ: "competition-preferences:read",
  COMPETITION_PREFERENCES_WRITE: "competition-preferences:write",
  /**
   * The notification inbox and push-subscription list for the current user.
   * Local DB reads only; bounded against a stuck client rather than cost.
   */
  NOTIFICATIONS_INBOX_READ: "notifications:inbox-read",
  /**
   * The unread-count poll behind the header bell. Separate from the inbox read
   * because it is issued far more often and costs far less — one indexed count
   * versus a page of rows with their targets — so sharing a bucket would let
   * polling starve the read someone is actually waiting on.
   */
  NOTIFICATIONS_UNREAD_COUNT: "notifications:unread-count",
  NOTIFICATIONS_MARK_READ: "notifications:mark-read",
  /**
   * Registering or revoking a browser's push token. The only user-facing
   * notification policy that fails closed — see its description.
   */
  PUSH_SUBSCRIPTIONS_WRITE: "push-subscriptions:write",
  /**
   * Creating, scheduling or cancelling a platform announcement. Admin-only, and
   * the one write in the system whose blast radius is every user.
   */
  ANNOUNCEMENTS_WRITE: "announcements:write",
} as const;

export type RateLimitPolicyId =
  (typeof RateLimitPolicyId)[keyof typeof RateLimitPolicyId];

export type RateLimitFailureMode = "open" | "closed";

/**
 * How the policy's subject(s) are resolved from a request.
 *
 *  - "ip"           — always the caller's trusted client IP, authenticated or not.
 *  - "user"         — always the authenticated actor's id. Only valid on routes
 *                      that already require authentication.
 *  - "user-or-ip"   — the actor's id when authenticated, else the IP. The
 *                      general-purpose strategy for routes with optional auth.
 *  - "global"       — one shared bucket for every caller. Reserved for
 *                      platform-wide spend budgets, not fairness limits.
 *  - "credential"   — the caller-submitted identifier (email/username) on a
 *                      pre-authentication endpoint. See `credentialSubject`
 *                      in subject.ts for why this is safe.
 *
 * A policy may list more than one strategy (`subjectStrategies`) to enforce
 * several dimensions at once — e.g. sign-in is limited per IP and per
 * submitted identifier; a request must pass every configured dimension.
 */
export type RateLimitSubjectStrategy =
  | "ip"
  | "user"
  | "user-or-ip"
  | "global"
  | "credential";

export interface RateLimitPolicy {
  readonly id: RateLimitPolicyId;
  readonly limit: number;
  readonly windowSeconds: number;
  readonly subjectStrategies: readonly [
    RateLimitSubjectStrategy,
    ...RateLimitSubjectStrategy[],
  ];
  readonly failureMode: RateLimitFailureMode;
  /** Why this number and this failure mode — for whoever tunes this next. */
  readonly description: string;
}

export const RATE_LIMIT_POLICIES: Readonly<
  Record<RateLimitPolicyId, RateLimitPolicy>
> = {
  [RateLimitPolicyId.TAXONOMY_CATEGORIES]: {
    id: RateLimitPolicyId.TAXONOMY_CATEGORIES,
    limit: 120,
    windowSeconds: 60,
    subjectStrategies: ["ip"],
    failureMode: "open",
    description:
      "Public, unauthenticated, indexed local table read. Guards database load, not spend, so a limiter outage should not block browsing.",
  },
  [RateLimitPolicyId.TAXONOMY_TECHNOLOGIES]: {
    id: RateLimitPolicyId.TAXONOMY_TECHNOLOGIES,
    limit: 120,
    windowSeconds: 60,
    subjectStrategies: ["ip"],
    failureMode: "open",
    description:
      "Same profile as taxonomy:categories, kept as a separate bucket so the two endpoints do not compete for one budget.",
  },
  [RateLimitPolicyId.PLACES_AUTOCOMPLETE]: {
    id: RateLimitPolicyId.PLACES_AUTOCOMPLETE,
    limit: 30,
    windowSeconds: 60,
    subjectStrategies: ["ip"],
    failureMode: "open",
    description:
      "Public autocomplete backed by billed Google Places calls. Fails open because blocking anonymous browsing during a DB blip is worse than a bounded window of unprotected spend; the global places:resolve budget is the hard spend cap behind it.",
  },
  [RateLimitPolicyId.PLACES_RESOLVE]: {
    id: RateLimitPolicyId.PLACES_RESOLVE,
    limit: 120,
    windowSeconds: 60,
    subjectStrategies: ["global"],
    failureMode: "closed",
    description:
      "Platform-wide Google Places resolution spend cap, not a per-caller limit. Fails closed: a DB outage must not become uncapped provider billing. The domain already has a graceful degradation path for this (PROVIDER_RATE_LIMITED falls back to a stale cache entry), so failing closed here costs nothing extra.",
  },
  [RateLimitPolicyId.ASSETS_UPLOAD_INTENT]: {
    id: RateLimitPolicyId.ASSETS_UPLOAD_INTENT,
    limit: 30,
    windowSeconds: 60 * 60,
    subjectStrategies: ["user"],
    failureMode: "closed",
    description:
      "Authenticated, billed Cloudinary spend. Fails closed: the actor is known and can be told to retry, and a DB outage must not uncap storage spend.",
  },
  [RateLimitPolicyId.ASSETS_FINALIZE]: {
    id: RateLimitPolicyId.ASSETS_FINALIZE,
    limit: 60,
    windowSeconds: 60 * 60,
    subjectStrategies: ["user"],
    failureMode: "closed",
    description:
      "Finalize follows upload-intent roughly 1:1; the higher ceiling than upload-intent allows for client retries without materially loosening the spend cap. Same failure-mode reasoning as upload-intent.",
  },
  [RateLimitPolicyId.COMPETITIONS_SEARCH]: {
    id: RateLimitPolicyId.COMPETITIONS_SEARCH,
    limit: 120,
    windowSeconds: 60,
    subjectStrategies: ["ip"],
    failureMode: "open",
    description:
      "Public search; a placeId filter can reach the billed places:resolve budget on a cache miss. This limit exists for availability, not spend: the global budget already caps spend, but is shared across every caller, so one abuser minting novel placeIds can otherwise exhaust it and degrade search for everyone. Fails open because it guards fairness, not money.",
  },
  [RateLimitPolicyId.COMPETITIONS_USER_STATE_WRITE]: {
    id: RateLimitPolicyId.COMPETITIONS_USER_STATE_WRITE,
    limit: 120,
    windowSeconds: 60,
    subjectStrategies: ["user"],
    failureMode: "open",
    description:
      "Bookmark and mark-as-registered toggles, authenticated (the route already requires a session, so `user` is valid here). One shared bucket for both: they are independent in the domain but identical in cost, so a single bucket is the honest way to bound one person's total toggling. 120/min is far above any real browsing rhythm while still stopping a stuck optimistic-retry loop from hammering the row. Two indexed upserts/deletes on a composite PK — local DB cost only, no spend — so it fails open: a limiter outage should not stop someone saving a competition.",
  },
  [RateLimitPolicyId.COMPETITIONS_USER_STATE_READ]: {
    id: RateLimitPolicyId.COMPETITIONS_USER_STATE_READ,
    limit: 120,
    windowSeconds: 60,
    subjectStrategies: ["user-or-ip"],
    failureMode: "open",
    description:
      "Batch 'which of these competitions have I saved/registered for' lookup that every competition list and detail page issues once on mount. Limited per user when signed in and per IP otherwise, because the endpoint answers anonymous callers with an empty list rather than a 401 and so must still be bounded for them. Matched to competitions:search, which it fires roughly 1:1 with on the list page. Two indexed reads, no spend — fails open, since losing it would leave every bookmark/registration button stuck in its unresolved state.",
  },
  [RateLimitPolicyId.PORTFOLIO_READ_PUBLIC]: {
    id: RateLimitPolicyId.PORTFOLIO_READ_PUBLIC,
    limit: 60,
    windowSeconds: 60,
    subjectStrategies: ["ip"],
    failureMode: "open",
    description:
      "Public portfolio read. Guards against enumeration/scraping of a full portfolio aggregate; local DB cost only, so it fails open.",
  },
  [RateLimitPolicyId.AUTH_SIGN_IN]: {
    id: RateLimitPolicyId.AUTH_SIGN_IN,
    limit: 10,
    windowSeconds: 60,
    subjectStrategies: ["ip", "credential"],
    failureMode: "closed",
    description:
      "Credential-stuffing protection. Limited per IP and per submitted identifier so a distributed attempt against one account is still bounded. Fails closed: a limiter outage must never become an open credential-stuffing window, the clearest fail-closed case in the system.",
  },
  [RateLimitPolicyId.AUTH_SIGN_UP]: {
    id: RateLimitPolicyId.AUTH_SIGN_UP,
    limit: 20,
    windowSeconds: 60 * 60,
    subjectStrategies: ["ip"],
    failureMode: "closed",
    description:
      "A basic account-rotation deterrent. Generous enough to not punish shared NAT/corporate egress signing up multiple real users. Fails closed for the same reason as sign-in.",
  },
  [RateLimitPolicyId.AUTH_PASSWORD_RESET_REQUEST]: {
    id: RateLimitPolicyId.AUTH_PASSWORD_RESET_REQUEST,
    limit: 5,
    windowSeconds: 60 * 60,
    subjectStrategies: ["ip", "credential"],
    failureMode: "closed",
    description:
      "Password-reset spam protection, symmetric for existent and non-existent accounts so the limiter itself never signals whether an address has an account.",
  },
  [RateLimitPolicyId.RECOMMENDATIONS_GENERATE]: {
    id: RateLimitPolicyId.RECOMMENDATIONS_GENERATE,
    limit: 30,
    windowSeconds: 60,
    subjectStrategies: ["user"],
    failureMode: "open",
    description:
      "Authenticated internal testing route for the Phase 0 recommendation engine (the route already requires a session, so `user` is valid here). 30/min is far above manual click-testing rhythm while still stopping a stuck retry loop from repeatedly re-running the full pipeline. Local DB read plus in-memory scoring only — no external spend — so it fails open: a limiter outage should not block a developer testing the engine.",
  },
  [RateLimitPolicyId.NOTIFICATION_PREFERENCES_READ]: {
    id: RateLimitPolicyId.NOTIFICATION_PREFERENCES_READ,
    limit: 120,
    windowSeconds: 60,
    subjectStrategies: ["user"],
    failureMode: "open",
    description:
      "Reading one's own notification preferences (the route already requires a session). One indexed read, local DB cost only — fails open, a limiter outage should not stop a settings page from loading.",
  },
  [RateLimitPolicyId.NOTIFICATION_PREFERENCES_WRITE]: {
    id: RateLimitPolicyId.NOTIFICATION_PREFERENCES_WRITE,
    limit: 60,
    windowSeconds: 60,
    subjectStrategies: ["user"],
    failureMode: "open",
    description:
      "Toggling one's own notification preferences. One indexed upsert, local DB cost only. 60/min is far above any real toggling rhythm while still stopping a stuck retry loop — fails open, a limiter outage should not block a settings change.",
  },
  [RateLimitPolicyId.COMPETITION_PREFERENCES_READ]: {
    id: RateLimitPolicyId.COMPETITION_PREFERENCES_READ,
    limit: 120,
    windowSeconds: 60,
    subjectStrategies: ["user"],
    failureMode: "open",
    description:
      "Reading one's own competition preference profile (the route already requires a session). One indexed read, local DB cost only — fails open.",
  },
  [RateLimitPolicyId.COMPETITION_PREFERENCES_WRITE]: {
    id: RateLimitPolicyId.COMPETITION_PREFERENCES_WRITE,
    limit: 30,
    windowSeconds: 60,
    subjectStrategies: ["user"],
    failureMode: "open",
    description:
      "Replacing one's own competition preference profile. Heavier than a bare upsert — validates category/technology/search-area values before a transactional delete+recreate — so the ceiling is lower than the read/toggle policies, but still local DB cost only, so it fails open.",
  },
  [RateLimitPolicyId.NOTIFICATIONS_INBOX_READ]: {
    id: RateLimitPolicyId.NOTIFICATIONS_INBOX_READ,
    limit: 120,
    windowSeconds: 60,
    subjectStrategies: ["user"],
    failureMode: "open",
    description:
      "Reading one's own notification inbox (the route already requires a session, so `user` is valid here). One keyset-paginated indexed read plus an unread count — local DB cost only, no spend. 120/min is far above opening an inbox and paging through it, while still stopping a stuck client from looping. Fails open: a limiter outage should not leave someone unable to see what they were notified about.",
  },
  [RateLimitPolicyId.NOTIFICATIONS_UNREAD_COUNT]: {
    id: RateLimitPolicyId.NOTIFICATIONS_UNREAD_COUNT,
    limit: 240,
    windowSeconds: 60,
    subjectStrategies: ["user"],
    failureMode: "open",
    description:
      "The unread-count poll behind the header bell. Deliberately its own bucket, and double the inbox allowance: it is issued on a timer rather than by a click, and costs one indexed count against `(userId, readAt)` rather than a page of rows. Sharing the inbox bucket would let background polling exhaust the budget for the read a user is actually waiting on. Fails open — losing it would freeze the badge, which is worse than serving a slightly stale count.",
  },
  [RateLimitPolicyId.NOTIFICATIONS_MARK_READ]: {
    id: RateLimitPolicyId.NOTIFICATIONS_MARK_READ,
    limit: 120,
    windowSeconds: 60,
    subjectStrategies: ["user"],
    failureMode: "open",
    description:
      "Marking one's own notifications read or responded, individually or in bulk. One indexed update scoped to the caller. 120/min covers clearing a full inbox item by item with room to spare. Fails open: local DB cost only, and a limiter outage should not leave someone unable to dismiss a notification.",
  },
  [RateLimitPolicyId.PUSH_SUBSCRIPTIONS_WRITE]: {
    id: RateLimitPolicyId.PUSH_SUBSCRIPTIONS_WRITE,
    limit: 20,
    windowSeconds: 60 * 60,
    subjectStrategies: ["user"],
    failureMode: "closed",
    description:
      "Registering or revoking a browser's push token. A browser registers roughly once per session, so 20/hour is generous for legitimate use including token rotation and several devices. Fails CLOSED, unlike the other notification policies: a stuck client looping here mints registrations against a billed external provider's quota, and an exhausted FCM quota degrades delivery for every user — the same reasoning as assets:upload-intent, where a DB outage must not become uncapped third-party spend.",
  },
  [RateLimitPolicyId.ANNOUNCEMENTS_WRITE]: {
    id: RateLimitPolicyId.ANNOUNCEMENTS_WRITE,
    limit: 30,
    windowSeconds: 60 * 60,
    subjectStrategies: ["user"],
    failureMode: "closed",
    description:
      "Creating, scheduling or cancelling a platform announcement. Admin-only and already authorized, so this is not a fairness limit — it is a blast-radius limit. One write here fans out to a notification for every user with the intent enabled, so an accidental loop is the one mistake in this subsystem that reaches everybody at once. 30/hour is far beyond any editorial rhythm. Fails closed for the same reason: if the limiter is unavailable, refusing an announcement costs a delay, while allowing an unbounded number costs every user's trust.",
  },
} as const;
