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

    // Portfolio creation is a baseline capability for every authenticated
    // role today — there is no subscription/plan system yet. This is the
    // seam a future plan/entitlement system will restrict: swap this
    // baseline entry for role- or plan-based grants when that system
    // exists, without touching PortfolioService.create or PortfolioPolicy.
    // See AuthorizationCode.UPGRADE_REQUIRED / FEATURE_DISABLED, already
    // reserved for that future denial path.
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
    ]),
} as const;