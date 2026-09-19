/**
 * Machine-readable authorization failure codes.
 *
 * These codes are shared across the backend and frontend.
 *
 * They should remain stable because they may be used for:
 * - Frontend UI
 * - Localization
 * - Logging
 * - Analytics
 * - Error handling
 */
export enum AuthorizationCode {
    /**
     * The actor does not have the required permission.
     */
    ROLE_PERMISSION_DENIED = "ROLE_PERMISSION_DENIED",

    /**
     * The actor's account has been suspended.
     */
    ACCOUNT_SUSPENDED = "ACCOUNT_SUSPENDED",

    /**
     * The actor's account has been banned.
     */
    ACCOUNT_BANNED = "ACCOUNT_BANNED",

    /**
     * The requested resource is archived.
     */
    RESOURCE_ARCHIVED = "RESOURCE_ARCHIVED",

    /**
     * The requested resource is locked.
     */
    RESOURCE_LOCKED = "RESOURCE_LOCKED",

    /**
     * The requested resource has been deleted.
     */
    RESOURCE_DELETED = "RESOURCE_DELETED",

    /**
     * The requested resource is private.
     */
    RESOURCE_PRIVATE = "RESOURCE_PRIVATE",

    /**
     * The actor must be the owner of the resource.
     */
    OWNER_REQUIRED = "OWNER_REQUIRED",

    /**
     * The actor must be a maintainer.
     */
    MAINTAINER_REQUIRED = "MAINTAINER_REQUIRED",

    /**
     * The requested action requires verification.
     */
    VERIFICATION_REQUIRED = "VERIFICATION_REQUIRED",

    /**
     * The requested feature requires an upgraded plan.
     */
    UPGRADE_REQUIRED = "UPGRADE_REQUIRED",

    /**
     * The requested operation is disabled.
     */
    FEATURE_DISABLED = "FEATURE_DISABLED",

    /**
     * A fallback code for unexpected authorization failures.
     */
    UNAUTHORIZED = "UNAUTHORIZED",

    /**
     * A fallback code for unexpected authorization failures.
     */
    UNKNOWN = "UNKNOWN",
}