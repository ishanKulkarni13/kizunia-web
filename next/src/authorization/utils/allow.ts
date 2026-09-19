import { AuthorizationAllowedDecision } from "../types/authorization-decision";

/**
 * Creates an allowed authorization decision.
 */
export function allow(): AuthorizationAllowedDecision {
    return {
        allowed: true,
    };
}