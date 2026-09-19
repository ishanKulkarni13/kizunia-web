import type { ErrorCategory } from "./error-category";

export interface AppErrorOptions {
    code: string;
    status: number;
    category: ErrorCategory;
    message: string;

    details?: unknown;
    retryable?: boolean;
    cause?: unknown;
}

export class AppError extends Error {
    readonly code: string;

    readonly status: number;

    readonly category: ErrorCategory;

    readonly details?: unknown;

    readonly retryable: boolean;

    constructor(options: AppErrorOptions) {
        super(options.message, {
            cause: options.cause,
        });

        this.name = new.target.name;

        this.code = options.code;
        this.status = options.status;
        this.category = options.category;
        this.details = options.details;
        this.retryable = options.retryable ?? false;

        Error.captureStackTrace?.(this, new.target);
    }
}