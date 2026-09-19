import { AuthorizationCode } from "../types/authorization-code";
import { AuthorizationDeniedDecision } from "../types/authorization-decision";

/**
 * Creates a denied authorization decision.
 */
export function deny(
    code: AuthorizationCode,
    message: string,
): AuthorizationDeniedDecision {
    return {
        allowed: false,
        code,
        message,
    };
}