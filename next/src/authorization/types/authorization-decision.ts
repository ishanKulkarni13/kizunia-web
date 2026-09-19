import { AuthorizationCode } from "./authorization-code";

/**
 * The result of an authorization check.
 *
 * Every authorization request in Kizunia returns an AuthorizationDecision.
 *
 * Never return booleans directly.
 *
 * This allows the backend, frontend, and logging system to
 * understand why an action was allowed or denied.
 */
export type AuthorizationDecision =
    | AuthorizationAllowedDecision
    | AuthorizationDeniedDecision;

/**
 * Returned when authorization succeeds.
 */
export interface AuthorizationAllowedDecision {
    allowed: true;
}

/**
 * Returned when authorization fails.
 */
export interface AuthorizationDeniedDecision {
    allowed: false;

    /**
     * Machine-readable reason for denial.
     */
    code: AuthorizationCode;

    /**
     * Human-readable explanation.
     *
     * Intended for debugging, logs, and developer tooling.
     * User-facing messages should generally be localized by the frontend
     * using the AuthorizationCode.
     */
    message: string;
}