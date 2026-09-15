export const CompetitionErrorCode = {
    NOT_FOUND: "COMPETITION_NOT_FOUND",

    DUPLICATE_SLUG: "COMPETITION_DUPLICATE_SLUG",

    DELETED: "COMPETITION_DELETED",

    ARCHIVED: "COMPETITION_ARCHIVED",

    LOCATION_NOT_FOUND: "COMPETITION_LOCATION_NOT_FOUND",

    LOCATION_LIMIT_REACHED: "COMPETITION_LOCATION_LIMIT_REACHED",

    LOCATION_REORDER_MISMATCH: "COMPETITION_LOCATION_REORDER_MISMATCH",

    LOCATION_SOURCE_MISSING: "COMPETITION_LOCATION_SOURCE_MISSING",

    LOCATION_PROVIDER_UNAVAILABLE: "COMPETITION_LOCATION_PROVIDER_UNAVAILABLE",

    LOCATION_RESOLUTION_FAILED: "COMPETITION_LOCATION_RESOLUTION_FAILED",

    /**
     * A radius was requested around a place the provider has no coordinates
     * for.
     *
     * Distinct from LOCATION_RESOLUTION_FAILED on purpose. That one means "we
     * could not find out, try again"; this one means "we found out, and there
     * is no centre to measure from" — retrying will never help, so telling the
     * user to retry would be false.
     *
     * It is an error rather than a silent fallback to search-area matching:
     * answering a distance question with an identity match would present a
     * different search than the one that was asked for, and the user would have
     * no way to tell.
     */
    RADIUS_ANCHOR_UNAVAILABLE: "COMPETITION_RADIUS_ANCHOR_UNAVAILABLE",

    BULK_IDS_NOT_FOUND: "COMPETITION_BULK_IDS_NOT_FOUND",

    BULK_UNAUTHORIZED: "COMPETITION_BULK_UNAUTHORIZED",

    TECHNOLOGY_NOT_FOUND: "COMPETITION_TECHNOLOGY_NOT_FOUND",

    /**
     * Attaching a Technology that does not exist, or that has been
     * soft-deleted from the global catalog. Re-checked server-side on every
     * attach — the catalog endpoint already excludes deleted rows, but a
     * stale client payload could still submit one.
     */
    TECHNOLOGY_INACTIVE: "COMPETITION_TECHNOLOGY_INACTIVE",

    ELIGIBILITY_NOT_FOUND: "COMPETITION_ELIGIBILITY_NOT_FOUND",

} as const;

export type CompetitionErrorCode =
    (typeof CompetitionErrorCode)[keyof typeof CompetitionErrorCode];