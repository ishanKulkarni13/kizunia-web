import type { AppError } from "./app-error";

export function createErrorResponse(
    error: AppError,
) {
    return {
        success: false,

        error: {
            code: error.code,
            message: error.message,
            category: error.category,
            retryable: error.retryable,
            details: error.details,
        },
    };
}