import { AppError, type AppErrorOptions } from "./app-error";
import { ErrorCategory } from "./error-category";

export type InternalErrorOptions =
    Omit<AppErrorOptions, "category">;

export class InternalError extends AppError {
    constructor(options: InternalErrorOptions) {
        super({
            ...options,
            category: ErrorCategory.INTERNAL,
        });
    }
}