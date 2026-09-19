export const ErrorCategory = {
    AUTHENTICATION: "authentication",
    AUTHORIZATION: "authorization",
    VALIDATION: "validation",
    RESOURCE: "resource",
    CONFLICT: "conflict",
    RATE_LIMIT: "rate_limit",
    EXTERNAL: "external",
    INTERNAL: "internal",
} as const;

export type ErrorCategory =
    (typeof ErrorCategory)[keyof typeof ErrorCategory];