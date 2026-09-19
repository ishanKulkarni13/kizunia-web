import { AppError, type AppErrorOptions } from "./app-error";
import { ErrorCategory } from "./error-category";
import { HttpStatus } from "./http-status";

export type ExternalServiceErrorOptions =
    Omit<AppErrorOptions, "category" | "status"> & {
        status?: number;
    };

/**
 * A dependency outside Kizunia could not answer.
 *
 * Distinct from a validation failure on purpose: the request was well formed
 * and may well succeed later, so it must never be reported as an empty or
 * negative result. "We could not find out" and "there is nothing" are
 * different answers.
 */
export class ExternalServiceError extends AppError {
    constructor(options: ExternalServiceErrorOptions) {
        super({
            ...options,
            status: options.status ?? HttpStatus.BAD_GATEWAY,
            category: ErrorCategory.EXTERNAL,
            retryable: options.retryable ?? true,
        });
    }
}
