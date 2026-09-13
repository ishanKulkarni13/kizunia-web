export enum CompetitionAction {

    VIEW = "VIEW",

    

    CREATE = "CREATE",

    EDIT = "EDIT",

    DELETE = "DELETE",

    /**
     * Reverses a soft delete.
     *
     * Deliberately absent from every role's set in `CompetitionPermissionSet`
     * — no OWNER/ORGANIZER/MAINTAINER grants it, by omission, not by a
     * negative rule. `CompetitionPolicy.canManage`'s existing chain makes
     * this admin-only on its own: `platformOverride()` is the only path that
     * can grant it, because the very next check in that chain requires the
     * competition to NOT be deleted — which a competition awaiting restore
     * always fails. See `CompetitionAuthorizer.restore`.
     */
    RESTORE = "RESTORE",

    PUBLISH = "PUBLISH",

    UNPUBLISH = "UNPUBLISH",

    VERIFY = "VERIFY",

    MANAGE_MEMBERS = "MANAGE_MEMBERS",

    MANAGE_MEDIA = "MANAGE_MEDIA",

    MANAGE_LINKS = "MANAGE_LINKS",

    /**
     * Attach/detach existing Technologies to this Competition. Governs only
     * the CompetitionTechnology relationship — it never grants authority
     * over the global Technology catalog, which is gated separately by
     * PlatformAction.MANAGE_TECHNOLOGIES.
     */
    MANAGE_TECHNOLOGIES = "MANAGE_TECHNOLOGIES",

    /**
     * Attach/detach eligibility values on this Competition. `EligibilityType`
     * is a fixed domain enum, not a global catalog, so unlike
     * `MANAGE_TECHNOLOGIES` this has no platform-level counterpart to defer
     * to.
     */
    MANAGE_ELIGIBILITY = "MANAGE_ELIGIBILITY",

}