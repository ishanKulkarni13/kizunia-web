import { PlatformRole } from "./roles";
import { PlatformAction } from "./actions";

/**
 * Baseline capabilities every signed-in role has, regardless of elevation.
 *
 * Permissions here are NOT inherited automatically by the evaluator — it
 * does a flat `permissionSet[role].has(action)` lookup — so every role must
 * spread these in explicitly. Without that, elevating a user to ADMIN would
 * silently *remove* their ability to browse public projects.
 */
const BASELINE: readonly PlatformAction[] = [
    PlatformAction.VIEW_PUBLIC_PROJECTS,
    PlatformAction.CREATE_PROJECT,
    PlatformAction.CREATE_COMPETITION_SUGGESTION,

    // "This role may create portfolios" — a baseline capability for every
    // authenticated role. Whether the user's PLAN includes portfolios is not
    // decided here: this set is a static role -> action map and must not
    // become dynamic. The entitlement step lives in PortfolioPolicy's create
    // chain (`UPGRADE_REQUIRED`, with the admin `platformOverride()` ahead of
    // it), fed by the actor's effective access — Subscription IB-4.
    PlatformAction.CREATE_PORTFOLIO,
];

export const PlatformPermissionSet = {
    [PlatformRole.USER]: new Set<PlatformAction>([
        ...BASELINE,
    ]),

    // TODO: MODERATOR's real capabilities are undecided. It is present here
    // only with the baseline, because every PlatformRole must have an entry
    // — a missing one makes `permissionSet[role]` undefined and every
    // permission check for that role throw. Granting suggestion review to
    // moderators later is a one-line addition here (VIEW_COMPETITION_SUGGESTIONS
    // + REVIEW_COMPETITION_SUGGESTIONS) — the suggestion review policy checks
    // this permission set directly rather than a role-identity bypass, so no
    // other code needs to change to enable it.
    [PlatformRole.MODERATOR]: new Set<PlatformAction>([
        ...BASELINE,
    ]),

    [PlatformRole.ADMIN]: new Set<PlatformAction>([
        ...BASELINE,
        PlatformAction.CREATE_COMPETITION,
        PlatformAction.VIEW_ALL_COMPETITIONS,
        PlatformAction.MANAGE_COMPETITION_LIFECYCLE,
        PlatformAction.ACCESS_ADMIN_DASHBOARD,
        PlatformAction.VIEW_COMPETITION_SUGGESTIONS,
        PlatformAction.REVIEW_COMPETITION_SUGGESTIONS,
        PlatformAction.MANAGE_TECHNOLOGIES,
        PlatformAction.MANAGE_MEDIA,
        PlatformAction.MANAGE_NOTIFICATION_ANNOUNCEMENTS,
        // Billing: view only. Grants and billing writes are SUPER_ADMIN's (IB-15).
        PlatformAction.VIEW_BILLING,
    ]),

    [PlatformRole.SUPER_ADMIN]: new Set<PlatformAction>([
        ...BASELINE,
        PlatformAction.CREATE_COMPETITION,
        PlatformAction.VIEW_ALL_COMPETITIONS,
        PlatformAction.MANAGE_COMPETITION_LIFECYCLE,
        PlatformAction.ACCESS_ADMIN_DASHBOARD,
        PlatformAction.MANAGE_USERS,
        PlatformAction.VIEW_COMPETITION_SUGGESTIONS,
        PlatformAction.REVIEW_COMPETITION_SUGGESTIONS,
        PlatformAction.MANAGE_TECHNOLOGIES,
        PlatformAction.MANAGE_MEDIA,
        PlatformAction.MANAGE_NOTIFICATION_ANNOUNCEMENTS,
        PlatformAction.VIEW_BILLING,
        PlatformAction.MANAGE_BILLING,
        PlatformAction.MANAGE_ENTITLEMENT_GRANTS,
        PlatformAction.VIEW_BILLING_RAW_PAYLOADS,
    ]),
} as const;